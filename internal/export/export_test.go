package export

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"testing/fstest"

	"github.com/wlingze/intentflow/internal/contract"
)

func samplePayload() (contract.Payload, contract.RevisionList) {
	payload := contract.Payload{
		Code:    contract.CodeBundle{Root: "PR #4", Files: []contract.CodeFile{{Path: "a.go", Status: contract.CodeStatusModified, Language: "go", Before: "old", After: "new"}}, Skipped: []string{}},
		Session: contract.ReviewSession{Version: 1},
	}
	revisions := contract.RevisionList{Base: "base", Head: "head", Current: "range", Revisions: []contract.Revision{{Id: "range", Kind: contract.RevisionKindRange, Label: "补丁"}}}
	return payload, revisions
}

func TestWriteProducesStaticSite(t *testing.T) {
	dist := fstest.MapFS{
		"index.html":    {Data: []byte(`<script type="module" src="./assets/app.js"></script>`)},
		"assets/app.js": {Data: []byte("console.log('app')")},
	}
	out := t.TempDir()
	payload, revisions := samplePayload()
	if err := Write(out, dist, payload, revisions, false); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"index.html", "assets/app.js", "api/payload.json", "api/revisions.json"} {
		if _, err := os.Stat(filepath.Join(out, filepath.FromSlash(name))); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
	}
	raw, err := os.ReadFile(filepath.Join(out, "api", "payload.json"))
	if err != nil {
		t.Fatal(err)
	}
	var got contract.Payload
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	if len(got.Code.Files) != 1 || got.Code.Files[0].After != "new" {
		t.Fatalf("payload = %+v", got)
	}
}

func TestWriteRefusesNonEmptyDirectory(t *testing.T) {
	out := t.TempDir()
	if err := os.WriteFile(filepath.Join(out, "keep.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	dist := fstest.MapFS{"index.html": {Data: []byte("ok")}}
	payload, revisions := samplePayload()
	if err := Write(out, dist, payload, revisions, false); err == nil {
		t.Fatal("expected refusal")
	}
	if err := Write(out, dist, payload, revisions, true); err != nil {
		t.Fatalf("force: %v", err)
	}
}
