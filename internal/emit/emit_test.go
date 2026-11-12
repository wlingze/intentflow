package emit

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wlingze/intentflow/internal/model"
)

func testFact(layer model.Layer, identity, title string) model.Fact {
	return model.Fact{
		Identity:   identity,
		Layer:      layer,
		Kind:       "call",
		Title:      title,
		Detail:     "detail of " + identity,
		File:       "main.go",
		Line:       7,
		Function:   "main",
		Confidence: model.Extracted,
	}
}

func factSet(facts ...model.Fact) model.FactSet {
	set := model.NewFactSet()
	for _, f := range facts {
		set.Add(f)
	}
	return set
}

func TestJSONWritesIndentedReviewAndCreatesDir(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "nested", "out")
	review := &model.Review{
		Before: "@abc1234",
		After:  "WORKTREE",
		Notes:  []string{"第一行", "第二行"},
	}

	got, err := JSON(review, dir)
	if err != nil {
		t.Fatalf("JSON: %v", err)
	}
	if want := filepath.Join(dir, "review.json"); got != want {
		t.Fatalf("path = %q, want %q", got, want)
	}

	buf, err := os.ReadFile(got)
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	if !strings.Contains(string(buf), "\n  \"after\"") {
		t.Fatalf("output is not indented JSON:\n%s", buf)
	}

	var round model.Review
	if err := json.Unmarshal(buf, &round); err != nil {
		t.Fatalf("output is not valid JSON: %v", err)
	}
	if round.Before != review.Before || round.After != review.After || len(round.Notes) != 2 {
		t.Fatalf("round trip lost data: %+v", round)
	}
}

func TestJSONOverwritesPreviousReview(t *testing.T) {
	dir := t.TempDir()
	if _, err := JSON(&model.Review{After: "first"}, dir); err != nil {
		t.Fatalf("first write: %v", err)
	}
	path, err := JSON(&model.Review{After: "second"}, dir)
	if err != nil {
		t.Fatalf("second write: %v", err)
	}

	var round model.Review
	buf, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	if err := json.Unmarshal(buf, &round); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if round.After != "second" {
		t.Fatalf("After = %q, want the newest review", round.After)
	}
}

func TestFactSetsWritesBothSides(t *testing.T) {
	before := factSet(
		testFact(model.LayerProject, "p1", "fetched before"),
		testFact(model.LayerLogic, "l1", "called before"),
		testFact(model.LayerIntent, "i1", "flowed before"),
	)
	after := factSet(
		testFact(model.LayerProject, "p2", "fetched after"),
		testFact(model.LayerIntent, "i2", "flowed after"),
	)
	dir := filepath.Join(t.TempDir(), "fresh")

	if err := FactSets(before, after, dir); err != nil {
		t.Fatalf("FactSets: %v", err)
	}

	buf, err := os.ReadFile(filepath.Join(dir, "facts.json"))
	if err != nil {
		t.Fatalf("read facts.json: %v", err)
	}
	var doc struct {
		Before []model.Fact `json:"before"`
		After  []model.Fact `json:"after"`
	}
	if err := json.Unmarshal(buf, &doc); err != nil {
		t.Fatalf("unmarshal facts.json: %v", err)
	}
	if len(doc.Before) != 3 {
		t.Fatalf("before has %d facts, want 3", len(doc.Before))
	}
	if len(doc.After) != 2 {
		t.Fatalf("after has %d facts, want 2", len(doc.After))
	}
	for _, f := range doc.Before {
		if f.Title != "fetched before" && f.Title != "called before" && f.Title != "flowed before" {
			t.Fatalf("unexpected before fact %+v", f)
		}
		if f.File != "main.go" || f.Line != 7 || f.Confidence != model.Extracted {
			t.Fatalf("fields not preserved: %+v", f)
		}
	}
}

// flatten 曾经直接遍历 map：同一输入两次写出可能得到不同顺序。
func TestFactSetsIsDeterministic(t *testing.T) {
	layers := []model.Layer{model.LayerProject, model.LayerLogic, model.LayerIntent}
	before := model.NewFactSet()
	after := model.NewFactSet()
	for _, layer := range layers {
		for _, id := range []string{"f", "b", "d", "a", "e", "c"} {
			before.Add(testFact(layer, string(layer)+"-"+id, "before"))
			after.Add(testFact(layer, string(layer)+"-"+id, "after"))
		}
	}

	var first []byte
	for i := 0; i < 20; i++ {
		dir := t.TempDir()
		if err := FactSets(before, after, dir); err != nil {
			t.Fatalf("run %d: %v", i, err)
		}
		buf, err := os.ReadFile(filepath.Join(dir, "facts.json"))
		if err != nil {
			t.Fatalf("run %d read back: %v", i, err)
		}
		if i == 0 {
			first = buf
			continue
		}
		if string(buf) != string(first) {
			t.Fatalf("run %d wrote a different byte sequence:\n--- first ---\n%s\n--- run %d ---\n%s", i, first, i, buf)
		}
	}
}

func TestFactSetsOrdersByLayerThenIdentity(t *testing.T) {
	set := factSet(
		testFact(model.LayerProject, "b-project", ""),
		testFact(model.LayerProject, "a-project", ""),
		testFact(model.LayerLogic, "z-logic", ""),
		testFact(model.LayerIntent, "m-intent", ""),
		testFact(model.LayerIntent, "c-intent", ""),
	)
	dir := t.TempDir()
	if err := FactSets(model.NewFactSet(), set, dir); err != nil {
		t.Fatalf("FactSets: %v", err)
	}

	buf, err := os.ReadFile(filepath.Join(dir, "facts.json"))
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	var doc struct {
		After []model.Fact `json:"after"`
	}
	if err := json.Unmarshal(buf, &doc); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	want := []string{"c-intent", "m-intent", "z-logic", "a-project", "b-project"}
	if len(doc.After) != len(want) {
		t.Fatalf("after has %d facts, want %d", len(doc.After), len(want))
	}
	for i, f := range doc.After {
		if f.Identity != want[i] {
			t.Fatalf("position %d = %q, want %q (all: %v)", i, f.Identity, want[i], doc.After)
		}
	}
}

func TestFactSetsWritesEmptySidesAsArrays(t *testing.T) {
	dir := t.TempDir()
	if err := FactSets(model.NewFactSet(), model.NewFactSet(), dir); err != nil {
		t.Fatalf("FactSets: %v", err)
	}
	buf, err := os.ReadFile(filepath.Join(dir, "facts.json"))
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	if strings.Contains(string(buf), "null") {
		t.Fatalf("empty sets must serialize as [], got:\n%s", buf)
	}
}
