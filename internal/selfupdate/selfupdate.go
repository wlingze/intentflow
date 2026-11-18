// Package selfupdate 把运行中的 intentflow 替换成 release 里的新版本。
//
// 发布产物见 .github/workflows/release.yml：六个平台的压缩包加 checksums.txt。
// 这里只认这两类资产：先校验 sha256，再写同目录临时文件，最后 rename 覆盖。
package selfupdate

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/wlingze/intentflow/internal/version"
)

const (
	// DefaultRepo 是官方发布仓库。
	DefaultRepo = "wlingze/intentflow"

	checksumsName      = "checksums.txt"
	maxAPIBytes        = 8 << 20
	maxDownloadBytes   = 256 << 20
	maxExecutableBytes = 256 << 20
)

// Result 是一次运行的结果：看到了哪些版本，是否下载并替换了文件。
type Result struct {
	Current   string // 当前版本，可能来自 ldflags 注入
	Latest    string // release tag，例如 v0.2.0
	Asset     string // 选中的资产名
	Available bool   // 是否存在比当前更新的版本
	Updated   bool   // 是否已经替换磁盘上的可执行文件
}

// Updater 执行一次更新。零值不可用，先用 New 或显式填好字段。
// 字段留空时 Run 会补默认值：官方仓库、当前平台、当前版本。
type Updater struct {
	Repo      string
	Token     string
	Current   string
	Requested string // --version；为空表示最新发布
	Check     bool
	Force     bool
	GOOS      string
	GOARCH    string
	Exe       string // 被替换的文件；留空取 os.Executable()
	Out       io.Writer
	HTTP      HTTPClient
	Releases  Releases
}

// New 返回带默认值的更新器，CLI 直接改字段即可。
func New() *Updater {
	return &Updater{
		Repo:    DefaultRepo,
		Token:   tokenFromEnv(),
		Current: version.Version,
		GOOS:    runtime.GOOS,
		GOARCH:  runtime.GOARCH,
		Out:     os.Stdout,
	}
}

func tokenFromEnv() string {
	if token := os.Getenv("GITHUB_TOKEN"); token != "" {
		return token
	}
	return os.Getenv("GH_TOKEN")
}

func (u *Updater) fillDefaults() {
	if u.Repo == "" {
		u.Repo = DefaultRepo
	}
	if u.Current == "" {
		u.Current = version.Version
	}
	if u.GOOS == "" {
		u.GOOS = runtime.GOOS
	}
	if u.GOARCH == "" {
		u.GOARCH = runtime.GOARCH
	}
	if u.Out == nil {
		u.Out = os.Stdout
	}
	if u.HTTP == nil {
		u.HTTP = defaultHTTPClient()
	}
	if u.Releases == nil {
		u.Releases = &GitHub{
			HTTP:      u.HTTP,
			Repo:      u.Repo,
			Token:     u.Token,
			UserAgent: "intentflow/" + u.Current,
		}
	}
}

// Run 查 release、校验下载、替换可执行文件。
// --check 只打印版本，不下载；发现新版本时通过 Result.Available 告知调用方。
func (u *Updater) Run(ctx context.Context) (Result, error) {
	u.fillDefaults()
	if err := validateRepo(u.Repo); err != nil {
		return Result{}, err
	}

	tag := ""
	if u.Requested != "" {
		t, err := normalizeTag(u.Requested)
		if err != nil {
			return Result{}, err
		}
		tag = t
	}
	rel, err := u.Releases.Release(ctx, tag)
	if err != nil {
		return Result{}, err
	}
	res := Result{Current: u.Current, Latest: rel.Tag}

	cur, curErr := parseVersion(u.Current)
	next, nextErr := parseVersion(rel.Tag)
	res.Available = nextErr == nil && (curErr != nil || next.Compare(cur) > 0)

	if u.Check {
		if res.Available {
			if _, err := u.platformAsset(rel); err != nil {
				return res, err
			}
		}
		u.reportCheck(res)
		return res, nil
	}

	if curErr == nil && nextErr == nil {
		cmp := next.Compare(cur)
		if tag == "" && cmp < 0 {
			fmt.Fprintf(u.Out, "当前版本 %s 高于最新发布 %s，不做改动\n", u.Current, rel.Tag)
			return res, nil
		}
		if cmp == 0 && !u.Force {
			if tag == "" {
				fmt.Fprintf(u.Out, "当前版本 %s 已是最新\n", u.Current)
			} else {
				fmt.Fprintf(u.Out, "当前版本已是 %s；如需重装加 --force\n", rel.Tag)
			}
			return res, nil
		}
	}

	asset, err := u.platformAsset(rel)
	if err != nil {
		return res, err
	}
	sumsAsset, ok := rel.Asset(checksumsName)
	if !ok {
		return res, fmt.Errorf("release %s 缺少 %s，无法校验下载", rel.Tag, checksumsName)
	}
	sums, err := u.download(ctx, sumsAsset.URL)
	if err != nil {
		return res, err
	}
	want, err := checksumFor(sums, asset.Name)
	if err != nil {
		return res, err
	}
	archive, err := u.download(ctx, asset.URL)
	if err != nil {
		return res, err
	}
	got := sha256Hex(archive)
	if !strings.EqualFold(got, want) {
		return res, fmt.Errorf("%s 校验失败：期望 %s，实际 %s；已中止，磁盘未改动", asset.Name, want, got)
	}
	data, err := extractExecutable(archive, asset.Name, executableName(u.GOOS))
	if err != nil {
		return res, err
	}

	exe := u.Exe
	if exe == "" {
		exe, err = os.Executable()
		if err != nil {
			return res, fmt.Errorf("找不到当前可执行文件：%w", err)
		}
	}
	// 安装目录里的 intentflow 常是软链（例如 ~/.local/bin）；替换真实文件，保留软链。
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	if err := installFile(exe, data, u.GOOS); err != nil {
		return res, err
	}
	res.Asset = asset.Name
	res.Updated = true
	fmt.Fprintf(u.Out, "已更新 %s → %s\n", u.Current, rel.Tag)
	fmt.Fprintf(u.Out, "  位置 %s\n", exe)
	return res, nil
}

func (u *Updater) reportCheck(res Result) {
	fmt.Fprintf(u.Out, "当前版本 %s\n", res.Current)
	fmt.Fprintf(u.Out, "最新版本 %s\n", res.Latest)
	if res.Available {
		fmt.Fprintln(u.Out, "有新版本可用：运行 intentflow update")
		return
	}
	fmt.Fprintln(u.Out, "已是最新版本")
}

// platformAsset 选出当前平台的压缩包；缺资产时明确报出期望的名字。
func (u *Updater) platformAsset(rel Release) (Asset, error) {
	name, err := assetName(rel.Tag, u.GOOS, u.GOARCH)
	if err != nil {
		return Asset{}, err
	}
	asset, ok := rel.Asset(name)
	if !ok {
		return Asset{}, fmt.Errorf("release %s 没有 %s/%s 的资产（期望 %s）", rel.Tag, u.GOOS, u.GOARCH, name)
	}
	return asset, nil
}

func (u *Updater) download(ctx context.Context, rawURL string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, fmt.Errorf("构造下载请求失败：%w", err)
	}
	req.Header.Set("User-Agent", "intentflow/"+u.Current)
	req.Header.Set("Accept", "application/octet-stream")
	// 资产地址可能是第三方主机，不发送 GITHUB_TOKEN。
	resp, err := u.HTTP.Do(req)
	if err != nil {
		return nil, fmt.Errorf("下载 %s 失败：%w", displayURL(rawURL), err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("下载 %s 失败：HTTP %d", displayURL(rawURL), resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxDownloadBytes+1))
	if err != nil {
		return nil, fmt.Errorf("下载 %s 中断：%w", displayURL(rawURL), err)
	}
	if int64(len(data)) > maxDownloadBytes {
		return nil, fmt.Errorf("下载 %s 超过 %d MiB 上限", displayURL(rawURL), maxDownloadBytes>>20)
	}
	return data, nil
}

// checksumFor 在 checksums.txt 里找资产对应的 sha256。
// 文件由 sha256sum 生成，格式是「摘要  文件名」。
func checksumFor(sums []byte, name string) (string, error) {
	for _, line := range strings.Split(string(sums), "\n") {
		fields := strings.Fields(line)
		if len(fields) != 2 {
			continue
		}
		if strings.TrimPrefix(fields[1], "*") != name {
			continue
		}
		sum := strings.ToLower(fields[0])
		if len(sum) != sha256.Size*2 || !isHex(sum) {
			return "", fmt.Errorf("%s 里 %s 的校验值不合法", checksumsName, name)
		}
		return sum, nil
	}
	return "", fmt.Errorf("%s 里没有 %s 的校验值", checksumsName, name)
}

func isHex(s string) bool {
	for _, r := range s {
		if (r < '0' || r > '9') && (r < 'a' || r > 'f') {
			return false
		}
	}
	return true
}

func sha256Hex(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

// displayURL 去掉查询串与用户信息，日志里不出现任何凭据。
func displayURL(raw string) string {
	parsed, err := url.Parse(raw)
	if err != nil {
		return "资产"
	}
	parsed.User = nil
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String()
}
