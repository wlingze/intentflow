package emit

import (
	"encoding/json"
	"os"
	"path/filepath"

	"github.com/wlingze/intentflow/internal/model"
)

// FactSets 把两侧的全量事实快照写成 facts.json，用于调试与人工核对。
func FactSets(before, after model.FactSet, dir string) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	payload := map[string]any{
		"before": flatten(before),
		"after":  flatten(after),
	}
	buf, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "facts.json"), buf, 0o644)
}

func flatten(s model.FactSet) []model.Fact {
	var out []model.Fact
	for _, layer := range []model.Layer{model.LayerIntent, model.LayerLogic, model.LayerProject} {
		for _, f := range s[layer] {
			out = append(out, f)
		}
	}
	return out
}
