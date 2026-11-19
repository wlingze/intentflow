// Package export writes a self-contained static workbench.
//
// The output has no server code: index.html, hashed assets and two JSON
// documents under api/. A plain static file server is enough.
package export

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"

	"github.com/wlingze/intentflow/internal/contract"
)

// Write copies dist into out and writes payload.json plus revisions.json.
// An existing non-empty directory is refused unless force is true.
func Write(out string, dist fs.FS, payload contract.Payload, revisions contract.RevisionList, force bool) error {
	if _, err := fs.Stat(dist, "index.html"); err != nil {
		return fmt.Errorf("前端产物缺少 index.html: %w", err)
	}
	if err := ensureDir(out, force); err != nil {
		return err
	}
	if err := copyTree(dist, out); err != nil {
		return err
	}
	apiDir := filepath.Join(out, "api")
	if err := os.MkdirAll(apiDir, 0o755); err != nil {
		return err
	}
	if err := writeJSON(filepath.Join(apiDir, "payload.json"), payload); err != nil {
		return err
	}
	return writeJSON(filepath.Join(apiDir, "revisions.json"), revisions)
}

func ensureDir(out string, force bool) error {
	info, err := os.Stat(out)
	if err == nil {
		if !info.IsDir() {
			return fmt.Errorf("%s 不是目录", out)
		}
		entries, err := os.ReadDir(out)
		if err != nil {
			return err
		}
		if len(entries) > 0 && !force {
			return fmt.Errorf("%s 不是空目录；先清理，或加 --force 覆盖同名文件", out)
		}
		return nil
	}
	if !os.IsNotExist(err) {
		return err
	}
	return os.MkdirAll(out, 0o755)
}

func copyTree(dist fs.FS, out string) error {
	return fs.WalkDir(dist, ".", func(name string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if name == "." {
			return nil
		}
		target := filepath.Join(out, filepath.FromSlash(name))
		if entry.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		data, err := fs.ReadFile(dist, name)
		if err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		return os.WriteFile(target, data, 0o644)
	})
}

func writeJSON(target string, value any) error {
	raw, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return os.WriteFile(target, raw, 0o644)
}
