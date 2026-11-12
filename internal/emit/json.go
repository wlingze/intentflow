// Package emit 负责写出 review.json 与 facts.json。
// 人类可读的工作台由 internal/serve + frontend/ 提供，不再生成内嵌 HTML。
package emit

import (
	"encoding/json"
	"os"
	"path/filepath"

	"github.com/wlingze/intentflow/internal/model"
)

// JSON 写出 review.json。
func JSON(r *model.Review, dir string) (string, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	p := filepath.Join(dir, "review.json")
	buf, err := json.MarshalIndent(r, "", "  ")
	if err != nil {
		return "", err
	}
	if err := os.WriteFile(p, buf, 0o644); err != nil {
		return "", err
	}
	return p, nil
}
