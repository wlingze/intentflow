package selfupdate

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"testing"
)

// testRelease 是一个不依赖 GitHub 的假发布：API 与下载都走 httptest。
type testRelease struct {
	tag      string
	archives map[string][]byte // 资产名 → 压缩包
	sums     string            // 覆盖 checksums.txt 内容
	omitSums bool
	srv      *httptest.Server

	mu        sync.Mutex
	apiPaths  []string
	apiAuth   []string
	dlAuth    []string
	downloads int
}

func newTestRelease(t *testing.T, tag string, archives map[string][]byte) *testRelease {
	t.Helper()
	tr := &testRelease{tag: tag, archives: archives}
	mux := http.NewServeMux()
	mux.HandleFunc("/repos/acme/intentflow/releases/", tr.handleRelease)
	mux.HandleFunc("/dl/", tr.handleDownload)
	tr.srv = httptest.NewServer(mux)
	t.Cleanup(tr.srv.Close)
	return tr
}

func (tr *testRelease) handleRelease(w http.ResponseWriter, r *http.Request) {
	tr.mu.Lock()
	tr.apiPaths = append(tr.apiPaths, r.URL.Path)
	tr.apiAuth = append(tr.apiAuth, r.Header.Get("Authorization"))
	tr.mu.Unlock()

	requested := ""
	switch {
	case strings.HasSuffix(r.URL.Path, "/releases/latest"):
		requested = tr.tag
	case strings.Contains(r.URL.Path, "/releases/tags/"):
		i := strings.Index(r.URL.Path, "/releases/tags/")
		requested = r.URL.Path[i+len("/releases/tags/"):]
	}
	if requested == "" || requested != tr.tag {
		http.NotFound(w, r)
		return
	}
	json.NewEncoder(w).Encode(Release{Tag: tr.tag, Assets: tr.assetList()})
}

func (tr *testRelease) handleDownload(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimPrefix(r.URL.Path, "/dl/")
	tr.mu.Lock()
	tr.downloads++
	tr.dlAuth = append(tr.dlAuth, r.Header.Get("Authorization"))
	tr.mu.Unlock()

	if name == checksumsName {
		if tr.omitSums {
			http.NotFound(w, r)
			return
		}
		fmt.Fprint(w, tr.checksums())
		return
	}
	data, ok := tr.archives[name]
	if !ok {
		http.NotFound(w, r)
		return
	}
	w.Write(data)
}

func (tr *testRelease) assetList() []Asset {
	assets := make([]Asset, 0, len(tr.archives)+1)
	for _, name := range sortedKeys(tr.archives) {
		assets = append(assets, Asset{Name: name, URL: tr.srv.URL + "/dl/" + name})
	}
	if !tr.omitSums {
		assets = append(assets, Asset{Name: checksumsName, URL: tr.srv.URL + "/dl/" + checksumsName})
	}
	return assets
}

func (tr *testRelease) checksums() string {
	if tr.sums != "" {
		return tr.sums
	}
	var b strings.Builder
	for _, name := range sortedKeys(tr.archives) {
		fmt.Fprintf(&b, "%x  %s\n", sha256.Sum256(tr.archives[name]), name)
	}
	return b.String()
}

func (tr *testRelease) updater(t *testing.T, exe string) *Updater {
	t.Helper()
	client := tr.srv.Client()
	return &Updater{
		Repo:     "acme/intentflow",
		Current:  "0.1.0",
		GOOS:     "linux",
		GOARCH:   "amd64",
		Exe:      exe,
		Out:      io.Discard,
		HTTP:     client,
		Releases: &GitHub{HTTP: client, API: tr.srv.URL, Repo: "acme/intentflow"},
	}
}

func (tr *testRelease) stats() (apiPaths, apiAuth, dlAuth []string, downloads int) {
	tr.mu.Lock()
	defer tr.mu.Unlock()
	return append([]string(nil), tr.apiPaths...), append([]string(nil), tr.apiAuth...), append([]string(nil), tr.dlAuth...), tr.downloads
}

func sortedKeys(m map[string][]byte) []string {
	names := make([]string, 0, len(m))
	for name := range m {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

func tarGz(t *testing.T, files map[string][]byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	for _, name := range sortedKeys(files) {
		data := files[name]
		hdr := &tar.Header{Name: "./" + name, Mode: 0o644, Size: int64(len(data)), Typeflag: tar.TypeReg}
		if err := tw.WriteHeader(hdr); err != nil {
			t.Fatal(err)
		}
		if _, err := tw.Write(data); err != nil {
			t.Fatal(err)
		}
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func zipArchive(t *testing.T, files map[string][]byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for _, name := range sortedKeys(files) {
		w, err := zw.Create("./" + name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write(files[name]); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func writeExe(t *testing.T, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "intentflow")
	if err := os.WriteFile(path, []byte(content), 0o755); err != nil {
		t.Fatal(err)
	}
	return path
}

func readExe(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func TestUpgradeInstallsLatestRelease(t *testing.T) {
	exe := writeExe(t, "old-binary")
	archive := tarGz(t, map[string][]byte{"intentflow": []byte("new-binary"), "LICENSE": []byte("license")})
	tr := newTestRelease(t, "v0.2.0", map[string][]byte{"intentflow_0.2.0_linux_amd64.tar.gz": archive})
	var out bytes.Buffer
	u := tr.updater(t, exe)
	u.Out = &out

	res, err := u.Run(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !res.Updated || res.Latest != "v0.2.0" || res.Asset != "intentflow_0.2.0_linux_amd64.tar.gz" {
		t.Fatalf("result = %+v", res)
	}
	if got := readExe(t, exe); got != "new-binary" {
		t.Fatalf("binary = %q", got)
	}
	info, err := os.Stat(exe)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o755 {
		t.Fatalf("mode = %v", info.Mode().Perm())
	}
	if _, _, _, downloads := tr.stats(); downloads != 2 {
		t.Fatalf("downloads = %d, want checksums + archive", downloads)
	}
	if !strings.Contains(out.String(), "0.1.0") || !strings.Contains(out.String(), "v0.2.0") {
		t.Fatalf("output does not print old → new: %q", out.String())
	}
}

func TestAlreadyLatestDoesNothing(t *testing.T) {
	exe := writeExe(t, "old-binary")
	archive := tarGz(t, map[string][]byte{"intentflow": []byte("new-binary")})
	tr := newTestRelease(t, "v0.2.0", map[string][]byte{"intentflow_0.2.0_linux_amd64.tar.gz": archive})
	var out bytes.Buffer
	u := tr.updater(t, exe)
	u.Current = "0.2.0"
	u.Out = &out

	res, err := u.Run(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if res.Updated || res.Available {
		t.Fatalf("result = %+v", res)
	}
	if _, _, _, downloads := tr.stats(); downloads != 0 {
		t.Fatalf("downloaded %d files for an up-to-date install", downloads)
	}
	if got := readExe(t, exe); got != "old-binary" {
		t.Fatalf("binary changed to %q", got)
	}
	if !strings.Contains(out.String(), "已是最新") {
		t.Fatalf("output = %q", out.String())
	}
}

func TestChecksumMismatchAborts(t *testing.T) {
	exe := writeExe(t, "old-binary")
	archive := tarGz(t, map[string][]byte{"intentflow": []byte("new-binary")})
	tr := newTestRelease(t, "v0.2.0", map[string][]byte{"intentflow_0.2.0_linux_amd64.tar.gz": archive})
	tr.sums = strings.Repeat("0", 64) + "  intentflow_0.2.0_linux_amd64.tar.gz\n"
	u := tr.updater(t, exe)

	_, err := u.Run(context.Background())
	if err == nil || !strings.Contains(err.Error(), "校验失败") {
		t.Fatalf("err = %v", err)
	}
	if got := readExe(t, exe); got != "old-binary" {
		t.Fatalf("binary replaced despite checksum failure: %q", got)
	}
}

func TestMissingPlatformAsset(t *testing.T) {
	exe := writeExe(t, "old-binary")
	archive := zipArchive(t, map[string][]byte{"intentflow.exe": []byte("new-binary")})
	tr := newTestRelease(t, "v0.2.0", map[string][]byte{"intentflow_0.2.0_windows_amd64.zip": archive})
	u := tr.updater(t, exe)

	_, err := u.Run(context.Background())
	if err == nil || !strings.Contains(err.Error(), "没有 linux/amd64 的资产") {
		t.Fatalf("err = %v", err)
	}
	if _, _, _, downloads := tr.stats(); downloads != 0 {
		t.Fatalf("downloaded %d files without a platform asset", downloads)
	}
	if got := readExe(t, exe); got != "old-binary" {
		t.Fatalf("binary changed to %q", got)
	}
}

func TestUnsupportedPlatform(t *testing.T) {
	exe := writeExe(t, "old-binary")
	tr := newTestRelease(t, "v0.2.0", map[string][]byte{})
	u := tr.updater(t, exe)
	u.GOOS = "freebsd"

	_, err := u.Run(context.Background())
	if err == nil || !strings.Contains(err.Error(), "不支持 freebsd/amd64") {
		t.Fatalf("err = %v", err)
	}
}

func TestCheckOnlyDoesNotDownload(t *testing.T) {
	exe := writeExe(t, "old-binary")
	archive := tarGz(t, map[string][]byte{"intentflow": []byte("new-binary")})
	tr := newTestRelease(t, "v0.2.0", map[string][]byte{"intentflow_0.2.0_linux_amd64.tar.gz": archive})
	var out bytes.Buffer
	u := tr.updater(t, exe)
	u.Check = true
	u.Out = &out

	res, err := u.Run(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !res.Available || res.Updated {
		t.Fatalf("result = %+v", res)
	}
	if _, _, _, downloads := tr.stats(); downloads != 0 {
		t.Fatalf("--check downloaded %d files", downloads)
	}
	if got := readExe(t, exe); got != "old-binary" {
		t.Fatalf("--check changed the binary to %q", got)
	}
	for _, want := range []string{"当前版本 0.1.0", "最新版本 v0.2.0", "有新版本可用"} {
		if !strings.Contains(out.String(), want) {
			t.Fatalf("output %q missing %q", out.String(), want)
		}
	}
}

func TestCheckReportsUpToDate(t *testing.T) {
	exe := writeExe(t, "old-binary")
	tr := newTestRelease(t, "v0.2.0", map[string][]byte{})
	var out bytes.Buffer
	u := tr.updater(t, exe)
	u.Current = "0.2.0"
	u.Check = true
	u.Out = &out

	res, err := u.Run(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if res.Available {
		t.Fatalf("result = %+v", res)
	}
	if !strings.Contains(out.String(), "已是最新版本") {
		t.Fatalf("output = %q", out.String())
	}
}

func TestRequestedVersionUsesTagEndpoint(t *testing.T) {
	exe := writeExe(t, "old-binary")
	archive := tarGz(t, map[string][]byte{"intentflow": []byte("v0.2.0-binary")})
	tr := newTestRelease(t, "v0.2.0", map[string][]byte{"intentflow_0.2.0_linux_amd64.tar.gz": archive})
	u := tr.updater(t, exe)
	u.Requested = "0.2.0"

	res, err := u.Run(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !res.Updated {
		t.Fatalf("result = %+v", res)
	}
	paths, _, _, _ := tr.stats()
	if len(paths) != 1 || paths[0] != "/repos/acme/intentflow/releases/tags/v0.2.0" {
		t.Fatalf("API paths = %v", paths)
	}
	if got := readExe(t, exe); got != "v0.2.0-binary" {
		t.Fatalf("binary = %q", got)
	}
}

func TestRequestedVersionMissing(t *testing.T) {
	exe := writeExe(t, "old-binary")
	tr := newTestRelease(t, "v0.2.0", map[string][]byte{})
	u := tr.updater(t, exe)
	u.Requested = "v9.9.9"

	_, err := u.Run(context.Background())
	if err == nil || !strings.Contains(err.Error(), "没有 release v9.9.9") {
		t.Fatalf("err = %v", err)
	}
}

func TestForceReinstallsSameVersion(t *testing.T) {
	exe := writeExe(t, "old-binary")
	archive := tarGz(t, map[string][]byte{"intentflow": []byte("same-version-binary")})
	tr := newTestRelease(t, "v0.2.0", map[string][]byte{"intentflow_0.2.0_linux_amd64.tar.gz": archive})
	u := tr.updater(t, exe)
	u.Current = "0.2.0"
	u.Force = true

	res, err := u.Run(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !res.Updated {
		t.Fatalf("result = %+v", res)
	}
	if got := readExe(t, exe); got != "same-version-binary" {
		t.Fatalf("binary = %q", got)
	}
}

func TestCurrentAheadOfLatestDoesNothing(t *testing.T) {
	exe := writeExe(t, "old-binary")
	tr := newTestRelease(t, "v0.2.0", map[string][]byte{})
	var out bytes.Buffer
	u := tr.updater(t, exe)
	u.Current = "0.3.0"
	u.Out = &out

	res, err := u.Run(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if res.Updated || res.Available {
		t.Fatalf("result = %+v", res)
	}
	if !strings.Contains(out.String(), "高于最新发布") {
		t.Fatalf("output = %q", out.String())
	}
}

func TestDevelopmentBuildInstallsLatest(t *testing.T) {
	exe := writeExe(t, "old-binary")
	archive := tarGz(t, map[string][]byte{"intentflow": []byte("release-binary")})
	tr := newTestRelease(t, "v0.2.0", map[string][]byte{"intentflow_0.2.0_linux_amd64.tar.gz": archive})
	u := tr.updater(t, exe)
	u.Current = "dev"

	res, err := u.Run(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !res.Updated {
		t.Fatalf("result = %+v", res)
	}
}

func TestMissingChecksumsAsset(t *testing.T) {
	exe := writeExe(t, "old-binary")
	archive := tarGz(t, map[string][]byte{"intentflow": []byte("new-binary")})
	tr := newTestRelease(t, "v0.2.0", map[string][]byte{"intentflow_0.2.0_linux_amd64.tar.gz": archive})
	tr.omitSums = true
	u := tr.updater(t, exe)

	_, err := u.Run(context.Background())
	if err == nil || !strings.Contains(err.Error(), "缺少 checksums.txt") {
		t.Fatalf("err = %v", err)
	}
	if got := readExe(t, exe); got != "old-binary" {
		t.Fatalf("binary changed to %q", got)
	}
}

func TestArchiveWithoutExecutable(t *testing.T) {
	exe := writeExe(t, "old-binary")
	archive := tarGz(t, map[string][]byte{"LICENSE": []byte("license")})
	tr := newTestRelease(t, "v0.2.0", map[string][]byte{"intentflow_0.2.0_linux_amd64.tar.gz": archive})
	u := tr.updater(t, exe)

	_, err := u.Run(context.Background())
	if err == nil || !strings.Contains(err.Error(), "压缩包里没有 intentflow") {
		t.Fatalf("err = %v", err)
	}
	if got := readExe(t, exe); got != "old-binary" {
		t.Fatalf("binary changed to %q", got)
	}
}

func TestWindowsZipUpgrade(t *testing.T) {
	dir := t.TempDir()
	exe := filepath.Join(dir, "intentflow.exe")
	if err := os.WriteFile(exe, []byte("old-windows-binary"), 0o755); err != nil {
		t.Fatal(err)
	}
	archive := zipArchive(t, map[string][]byte{"intentflow.exe": []byte("new-windows-binary"), "README.md": []byte("readme")})
	tr := newTestRelease(t, "v0.2.0", map[string][]byte{"intentflow_0.2.0_windows_amd64.zip": archive})
	u := tr.updater(t, exe)
	u.GOOS = "windows"

	res, err := u.Run(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !res.Updated || res.Asset != "intentflow_0.2.0_windows_amd64.zip" {
		t.Fatalf("result = %+v", res)
	}
	if got := readExe(t, exe); got != "new-windows-binary" {
		t.Fatalf("binary = %q", got)
	}
	if _, err := os.Stat(exe + ".old"); !os.IsNotExist(err) {
		t.Fatalf("backup left behind: %v", err)
	}
}

func TestTokenGoesToAPIOnly(t *testing.T) {
	exe := writeExe(t, "old-binary")
	archive := tarGz(t, map[string][]byte{"intentflow": []byte("new-binary")})
	tr := newTestRelease(t, "v0.2.0", map[string][]byte{"intentflow_0.2.0_linux_amd64.tar.gz": archive})
	var out bytes.Buffer
	u := tr.updater(t, exe)
	u.Token = "s3cr3t"
	u.Releases = &GitHub{HTTP: tr.srv.Client(), API: tr.srv.URL, Repo: "acme/intentflow", Token: "s3cr3t"}
	u.Out = &out

	if _, err := u.Run(context.Background()); err != nil {
		t.Fatal(err)
	}
	_, apiAuth, dlAuth, _ := tr.stats()
	if len(apiAuth) != 1 || apiAuth[0] != "Bearer s3cr3t" {
		t.Fatalf("API auth = %v", apiAuth)
	}
	for _, got := range dlAuth {
		if got != "" {
			t.Fatalf("download leaked the token: %q", got)
		}
	}
	if strings.Contains(out.String(), "s3cr3t") {
		t.Fatalf("output leaked the token: %q", out.String())
	}
}

func TestDefaultClientKeepsProxySupport(t *testing.T) {
	client, ok := defaultHTTPClient().(*http.Client)
	if !ok {
		t.Fatal("defaultHTTPClient is not an *http.Client")
	}
	transport, ok := client.Transport.(*http.Transport)
	if !ok {
		t.Fatalf("transport = %T", client.Transport)
	}
	if transport.Proxy == nil {
		t.Fatal("transport.Proxy is nil: HTTPS_PROXY would be ignored")
	}
}

func TestForceDoesNotDowngrade(t *testing.T) {
	exe := writeExe(t, "old-binary")
	tr := newTestRelease(t, "v0.2.0", map[string][]byte{})
	var out bytes.Buffer
	u := tr.updater(t, exe)
	u.Current = "0.3.0"
	u.Force = true
	u.Out = &out

	res, err := u.Run(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if res.Updated {
		t.Fatalf("result = %+v", res)
	}
	if !strings.Contains(out.String(), "高于最新发布") {
		t.Fatalf("output = %q", out.String())
	}
}
