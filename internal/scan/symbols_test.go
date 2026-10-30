package scan

import (
	"testing"

	"github.com/yaklang/intentflow/internal/contract"
)

func TestBuildSymbolGraphMergesBothSides(t *testing.T) {
	before := &IRIndex{
		Funcs: map[string]*IRFunc{
			"a": {Short: "Main", File: "main.go", Line: 3, Hash: "h1", Calls: map[string]int32{"Helper": 4, "Missing": 5}},
			"b": {Short: "Helper", File: "main.go", Line: 9, Hash: "h2"},
		},
		Types: map[string]*IRType{
			"t1": {Name: "Config", Kind: "struct", File: "main.go", Line: 1},
		},
	}
	after := &IRIndex{
		Funcs: map[string]*IRFunc{
			"a": {Short: "Main", File: "main.go", Line: 3, Hash: "h1", Calls: map[string]int32{"Helper": 4, "Extra": 6}},
			"b": {Short: "Helper", File: "main.go", Line: 9, Hash: "h2"},
			"c": {Short: "Extra", File: "extra.go", Line: 3, Hash: "h3"},
		},
		Types: map[string]*IRType{
			"t1": {Name: "Config", Kind: "struct", File: "main.go", Line: 1},
			"t2": {Name: "Option", Kind: "interface", File: "extra.go", Line: 1},
		},
	}

	graph := BuildSymbolGraph(before, after)
	if graph.Stats.Functions != 3 || graph.Stats.Types != 2 {
		t.Fatalf("unexpected stats: %+v", graph.Stats)
	}

	byID := map[string]string{}
	for _, node := range graph.Nodes {
		byID[node.Id] = string(node.Delta)
	}
	if got := byID["fn:main.go#Main"]; got != string(contract.DeltaKindUnchanged) {
		t.Errorf("Main delta = %q", got)
	}
	if got := byID["fn:extra.go#Extra"]; got != string(contract.DeltaKindAdded) {
		t.Errorf("Extra delta = %q", got)
	}
	if got := byID["type:extra.go#Option"]; got != string(contract.DeltaKindAdded) {
		t.Errorf("Option delta = %q", got)
	}

	// Main 的 body hash 变了，但签名没变；这里用 hash 判定修改。
	before.Funcs["a"].Hash = "changed"
	graph = BuildSymbolGraph(before, after)
	for _, node := range graph.Nodes {
		if node.Id == "fn:main.go#Main" && node.Delta != contract.DeltaKindModified {
			t.Errorf("Main should be modified after hash change, got %q", node.Delta)
		}
	}

	// 未解析的调用保留在 unresolved，不造边。
	if graph.Stats.Unresolved != 1 {
		t.Fatalf("unresolved = %d, want 1", graph.Stats.Unresolved)
	}
	if graph.Unresolved[0].Name != "Missing" {
		t.Errorf("unresolved name = %q", graph.Unresolved[0].Name)
	}
}
