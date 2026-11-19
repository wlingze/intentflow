package payload

import (
	"testing"

	"github.com/wlingze/intentflow/internal/contract"
)

func TestBuildPatchMapsFilesAndLanguages(t *testing.T) {
	bundle, err := BuildPatch([]byte(`diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,2 +1,2 @@
-old
+new
 keep
diff --git a/README.md b/README.md
--- a/README.md
+++ b/README.md
@@ -1,1 +1,2 @@
 title
+body
`), "PR #4")
	if err != nil {
		t.Fatal(err)
	}
	if bundle.Root != "PR #4" || len(bundle.Files) != 2 {
		t.Fatalf("bundle = %+v", bundle)
	}
	if bundle.Files[0].Path != "README.md" || bundle.Files[0].Language != "markdown" {
		t.Fatalf("README = %+v", bundle.Files[0])
	}
	app := bundle.Files[1]
	if app.Path != "src/app.ts" || app.Language != "typescript" || app.Status != contract.CodeStatusModified {
		t.Fatalf("app = %+v", app)
	}
	if app.Before != "old\nkeep" || app.After != "new\nkeep" {
		t.Fatalf("app text = %q -> %q", app.Before, app.After)
	}
}
