// Package emit 负责把 Review 输出成两种消费者能用的形式：
//   - review.json：给 agent 读的结构化结果
//   - index.html：给人 review 的三层视图
package emit

import (
	"encoding/json"
	"os"
	"path/filepath"

	"github.com/yaklang/intentflow/internal/model"
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
