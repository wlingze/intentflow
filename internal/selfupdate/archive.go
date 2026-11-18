package selfupdate

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"fmt"
	"io"
	pathpkg "path"
	"strings"
)

// assetName 按 release.yml 的命名拼出平台资产名：
// intentflow_<版本>_<os>_<arch>.tar.gz，Windows 用 .zip。
func assetName(tag, goos, goarch string) (string, error) {
	version := strings.TrimPrefix(tag, "v")
	switch goos + "/" + goarch {
	case "linux/amd64", "linux/arm64", "darwin/amd64", "darwin/arm64":
		return "intentflow_" + version + "_" + goos + "_" + goarch + ".tar.gz", nil
	case "windows/amd64", "windows/arm64":
		return "intentflow_" + version + "_" + goos + "_" + goarch + ".zip", nil
	}
	return "", fmt.Errorf("不支持 %s/%s；发布只覆盖 linux、darwin、windows 的 amd64 与 arm64", goos, goarch)
}

// executableName 是压缩包里可执行文件的名字。
func executableName(goos string) string {
	if goos == "windows" {
		return "intentflow.exe"
	}
	return "intentflow"
}

// extractExecutable 从资产内容里取出可执行文件。
func extractExecutable(archive []byte, asset, exe string) ([]byte, error) {
	switch {
	case strings.HasSuffix(asset, ".tar.gz"):
		return extractTarGz(archive, exe)
	case strings.HasSuffix(asset, ".zip"):
		return extractZip(archive, exe)
	}
	return nil, fmt.Errorf("不认识的资产格式 %s", asset)
}

func extractTarGz(archive []byte, exe string) ([]byte, error) {
	gz, err := gzip.NewReader(bytes.NewReader(archive))
	if err != nil {
		return nil, fmt.Errorf("解压 tar.gz 失败：%w", err)
	}
	defer gz.Close()
	tr := tar.NewReader(gz)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("读取 tar.gz 失败：%w", err)
		}
		if hdr.Typeflag != tar.TypeReg {
			continue
		}
		if entryName(hdr.Name) != exe {
			continue
		}
		return readLimited(tr, maxExecutableBytes)
	}
	return nil, fmt.Errorf("压缩包里没有 %s", exe)
}

func extractZip(archive []byte, exe string) ([]byte, error) {
	zr, err := zip.NewReader(bytes.NewReader(archive), int64(len(archive)))
	if err != nil {
		return nil, fmt.Errorf("解压 zip 失败：%w", err)
	}
	for _, f := range zr.File {
		if f.FileInfo().IsDir() || entryName(f.Name) != exe {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return nil, fmt.Errorf("读取 zip 里的 %s 失败：%w", f.Name, err)
		}
		data, err := readLimited(rc, maxExecutableBytes)
		rc.Close()
		return data, err
	}
	return nil, fmt.Errorf("压缩包里没有 %s", exe)
}

// entryName 取压缩包条目里的文件名，兼容 ./intentflow 与反斜杠路径。
func entryName(name string) string {
	return pathpkg.Base(strings.ReplaceAll(name, "\\", "/"))
}

func readLimited(r io.Reader, limit int64) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(r, limit+1))
	if err != nil {
		return nil, fmt.Errorf("读取可执行文件失败：%w", err)
	}
	if int64(len(data)) > limit {
		return nil, fmt.Errorf("可执行文件超过 %d MiB", limit>>20)
	}
	return data, nil
}
