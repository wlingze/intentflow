package selfupdate

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
)

// installFile 用 data 替换 target，尽量做到要么是旧文件、要么是新文件。
//
// 同目录临时文件 + rename 是 POSIX 的原子替换。Windows 上正在运行的可执行
// 文件不能直接覆盖，所以先把旧文件改名，再放新文件；失败时把旧文件改回来。
func installFile(target string, data []byte, goos string) error {
	dir := filepath.Dir(target)
	tmp, err := os.CreateTemp(dir, "."+filepath.Base(target)+"-*")
	if err != nil {
		return fmt.Errorf("在 %s 创建临时文件失败（可能没有写权限）：%w", dir, err)
	}
	tmpName := tmp.Name()
	keep := false
	defer func() {
		if !keep {
			os.Remove(tmpName)
		}
	}()
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return fmt.Errorf("写临时文件失败：%w", err)
	}
	if err := tmp.Chmod(0o755); err != nil {
		tmp.Close()
		return fmt.Errorf("设置权限失败：%w", err)
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return fmt.Errorf("落盘失败：%w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("关闭临时文件失败：%w", err)
	}
	if goos == "windows" {
		err = replaceWindows(target, tmpName)
	} else {
		err = os.Rename(tmpName, target)
	}
	if err != nil {
		return fmt.Errorf("替换 %s 失败（可能没有写权限）：%w", target, err)
	}
	keep = true
	return nil
}

// replaceWindows 先备份旧文件再替换，第二步失败就回滚。
// 正在运行的旧文件可能删不掉，留在 <target>.old，下次更新时会先清掉。
func replaceWindows(target, tmp string) error {
	backup := target + ".old"
	_ = os.Remove(backup)
	if err := os.Rename(target, backup); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	if err := os.Rename(tmp, target); err != nil {
		if rollbackErr := os.Rename(backup, target); rollbackErr != nil {
			return fmt.Errorf("放入新文件失败：%v；回滚也失败：%v；备份留在 %s", err, rollbackErr, backup)
		}
		return err
	}
	_ = os.Remove(backup)
	return nil
}
