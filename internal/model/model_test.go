package model

import (
	"testing"
)

// fact 造一条只填必要字段的事实：Identity 决定 diff，Title 用来分辨保留了哪一条。
func fact(layer Layer, identity, title string) Fact {
	return Fact{Identity: identity, Layer: layer, Kind: "call", Title: title, Confidence: Derived}
}

func TestAddKeepsFirstFactForAnIdentity(t *testing.T) {
	set := NewFactSet()
	set.Add(fact(LayerProject, "p1", "先到"))
	set.Add(fact(LayerProject, "p1", "后到"))

	if got := set.Len(LayerProject); got != 1 {
		t.Fatalf("Len(project) = %d, want 1", got)
	}
	if got := set[LayerProject]["p1"].Title; got != "先到" {
		t.Fatalf("kept title %q, want the first one", got)
	}
}

func TestAddIndexesEachLayerSeparately(t *testing.T) {
	set := NewFactSet()
	set.Add(fact(LayerProject, "same", "project"))
	set.Add(fact(LayerLogic, "same", "logic"))
	set.Add(fact(LayerIntent, "same", "intent"))

	for _, layer := range []Layer{LayerProject, LayerLogic, LayerIntent} {
		if got := set.Len(layer); got != 1 {
			t.Fatalf("Len(%s) = %d, want 1", layer, got)
		}
		if got := set[layer]["same"].Title; got != string(layer) {
			t.Fatalf("layer %s kept %q", layer, got)
		}
	}
}

func TestLenCountsPerLayerAndIgnoresUnknownLayers(t *testing.T) {
	set := NewFactSet()
	set.Add(fact(LayerProject, "p1", ""))
	set.Add(fact(LayerLogic, "l1", ""))
	set.Add(fact(LayerLogic, "l2", ""))

	if got := set.Len(LayerProject); got != 1 {
		t.Fatalf("Len(project) = %d, want 1", got)
	}
	if got := set.Len(LayerLogic); got != 2 {
		t.Fatalf("Len(logic) = %d, want 2", got)
	}
	if got := set.Len(LayerIntent); got != 0 {
		t.Fatalf("Len(intent) = %d, want 0", got)
	}
	if got := set.Len("unknown"); got != 0 {
		t.Fatalf("Len(unknown) = %d, want 0", got)
	}
}

func TestDiffReportsAddedAndRemovedSortedByIdentity(t *testing.T) {
	before := NewFactSet()
	for _, id := range []string{"p3", "p1", "p2"} {
		before.Add(fact(LayerProject, id, "old "+id))
	}
	after := NewFactSet()
	for _, id := range []string{"p1", "p5", "p4"} {
		after.Add(fact(LayerProject, id, "new "+id))
	}

	d := Diff(LayerProject, before, after)
	if got, want := identities(d.Added), []string{"p4", "p5"}; !equal(got, want) {
		t.Fatalf("added = %v, want %v", got, want)
	}
	if got, want := identities(d.Removed), []string{"p2", "p3"}; !equal(got, want) {
		t.Fatalf("removed = %v, want %v", got, want)
	}
	if got := DeltaCount(d); got != 4 {
		t.Fatalf("DeltaCount = %d, want 4", got)
	}
	if DeltaEmpty(d) {
		t.Fatal("DeltaEmpty = true for a non-empty delta")
	}
}

// Diff 从 map 取值，不排序时顺序随机：同一输入跑多次必须给出同一结果。
func TestDiffIsDeterministic(t *testing.T) {
	before := NewFactSet()
	after := NewFactSet()
	for _, id := range []string{"c", "a", "e", "b", "d", "f", "g", "h"} {
		after.Add(fact(LayerProject, id, ""))
	}
	before.Add(fact(LayerProject, "dead", ""))

	want := identities(Diff(LayerProject, before, after).Added)
	for i := 0; i < 50; i++ {
		if got := identities(Diff(LayerProject, before, after).Added); !equal(got, want) {
			t.Fatalf("run %d gave %v, want %v", i, got, want)
		}
	}
}

func TestDiffKeepsLayersApart(t *testing.T) {
	before := NewFactSet()
	before.Add(fact(LayerProject, "shared", "project"))
	after := NewFactSet()
	after.Add(fact(LayerLogic, "shared", "logic"))

	if d := Diff(LayerProject, before, after); len(d.Removed) != 1 || len(d.Added) != 0 {
		t.Fatalf("project delta = %+v, want only the removal", d)
	}
	if d := Diff(LayerLogic, before, after); len(d.Added) != 1 || len(d.Removed) != 0 {
		t.Fatalf("logic delta = %+v, want only the addition", d)
	}
	if d := Diff(LayerIntent, before, after); !DeltaEmpty(d) || d.Added == nil || d.Removed == nil {
		t.Fatalf("intent delta = %+v, want empty non-nil slices", d)
	}
}

func TestIdentityIsStableAndOrderSensitive(t *testing.T) {
	first := Identity("call", "main.go", "db.Query")
	if len(first) != 16 {
		t.Fatalf("Identity length = %d, want 16 hex chars", len(first))
	}
	if repeat := Identity("call", "main.go", "db.Query"); repeat != first {
		t.Fatalf("same parts gave %q then %q", first, repeat)
	}
	if swapped := Identity("db.Query", "main.go", "call"); swapped == first {
		t.Fatal("argument order does not change the identity")
	}
	if joined := Identity("db.Querymain.go", "call"); joined == first {
		t.Fatal("different part boundaries share an identity")
	}
	if none := Identity(); none != Identity() {
		t.Fatal("Identity() is not stable")
	}
}

func identities(fs []Fact) []string {
	out := make([]string, len(fs))
	for i, f := range fs {
		out[i] = f.Identity
	}
	return out
}

func equal(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
