package emit

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"

	"github.com/wlingze/intentflow/internal/model"
)

// layerOrder 固定层内排列顺序，从最上层（意图）到最下层（项目）。
// diff 结果按此顺序展示，facts.json 也照同一顺序写出。
var layerOrder = []model.Layer{model.LayerIntent, model.LayerLogic, model.LayerProject}

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

// flatten 把一层一层的 map 摊平成切片。
//
// FactSet 的内层是 map，遍历顺序随机；这里先按 layerOrder 分层，
// 再按 Identity 排序。否则同一输入两次写出的 facts.json 顺序可能不同，
// 人工核对与文本 diff 都会出现假变化。
func flatten(s model.FactSet) []model.Fact {
	out := []model.Fact{}
	for _, layer := range layerOrder {
		facts := make([]model.Fact, 0, len(s[layer]))
		for _, f := range s[layer] {
			facts = append(facts, f)
		}
		sort.Slice(facts, func(i, j int) bool { return facts[i].Identity < facts[j].Identity })
		out = append(out, facts...)
	}
	return out
}
