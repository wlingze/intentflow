package patchdiff

import (
	"strings"
	"testing"

	"github.com/wlingze/intentflow/internal/contract"
)

func parseOne(t *testing.T, raw string) (contract.CodeBundle, Meta) {
	t.Helper()
	bundle, meta, err := Parse([]byte(raw))
	if err != nil {
		t.Fatal(err)
	}
	return bundle, meta
}

func fileByPath(t *testing.T, bundle contract.CodeBundle, path string) contract.CodeFile {
	t.Helper()
	for _, file := range bundle.Files {
		if file.Path == path {
			return file
		}
	}
	t.Fatalf("file %q not found in %+v", path, bundle.Files)
	return contract.CodeFile{}
}

func TestModifiedMultiHunkKeepsRealLineNumbers(t *testing.T) {
	raw := `diff --git a/x.go b/x.go
index 1111111..2222222 100644
--- a/x.go
+++ b/x.go
@@ -3,3 +3,3 @@
 line3
-old
+new
 line5
@@ -9,2 +9,3 @@
 line9
+added
 line10
`
	bundle, _ := parseOne(t, raw)
	file := fileByPath(t, bundle, "x.go")
	if file.Status != contract.CodeStatusModified || file.Language != "go" {
		t.Fatalf("file = %+v", file)
	}
	before := strings.Split(file.Before, "\n")
	after := strings.Split(file.After, "\n")
	if len(before) != 10 || len(after) != 11 {
		t.Fatalf("line counts before=%d after=%d", len(before), len(after))
	}
	if before[0] != "" || before[2] != "line3" || before[3] != "old" || before[8] != "line9" || before[9] != "line10" {
		t.Fatalf("before = %#v", before)
	}
	if after[2] != "line3" || after[3] != "new" || after[8] != "line9" || after[9] != "added" || after[10] != "line10" {
		t.Fatalf("after = %#v", after)
	}
}

func TestAddedAndDeletedFiles(t *testing.T) {
	added := `diff --git a/new.txt b/new.txt
new file mode 100644
index 0000000..1234567
--- /dev/null
+++ b/new.txt
@@ -0,0 +1,2 @@
+hello
+world
`
	bundle, _ := parseOne(t, added)
	file := fileByPath(t, bundle, "new.txt")
	if file.Status != contract.CodeStatusAdded || file.Before != "" || file.After != "hello\nworld" {
		t.Fatalf("added = %+v", file)
	}

	deleted := `diff --git a/old.txt b/old.txt
deleted file mode 100644
index 89abcde..0000000
--- a/old.txt
+++ /dev/null
@@ -1,2 +0,0 @@
-bye
-now
`
	bundle, _ = parseOne(t, deleted)
	file = fileByPath(t, bundle, "old.txt")
	if file.Status != contract.CodeStatusRemoved || file.Before != "bye\nnow" || file.After != "" {
		t.Fatalf("deleted = %+v", file)
	}
}

func TestRenameAndQuotedPath(t *testing.T) {
	raw := `diff --git a/old name.txt b/new name.txt
similarity index 100%
rename from old name.txt
rename to new name.txt
diff --git "a/sp ace.go" "b/sp ace.go"
index 1111111..2222222 100644
--- "a/sp ace.go"
+++ "b/sp ace.go"
@@ -1 +1 @@
-old
+new
`
	bundle, _ := parseOne(t, raw)
	renamed := fileByPath(t, bundle, "new name.txt")
	if renamed.Status != contract.CodeStatusRenamed || renamed.OldPath == nil || *renamed.OldPath != "old name.txt" {
		t.Fatalf("renamed = %+v", renamed)
	}
	quoted := fileByPath(t, bundle, "sp ace.go")
	if quoted.Status != contract.CodeStatusModified || quoted.After != "new" {
		t.Fatalf("quoted = %+v", quoted)
	}
}

func TestNoNewlineMarkerAndPlainDiff(t *testing.T) {
	raw := `--- a/plain.txt
+++ b/plain.txt
@@ -1,2 +1,2 @@
 keep
-old
\ No newline at end of file
+new
\ No newline at end of file
`
	bundle, _ := parseOne(t, raw)
	file := fileByPath(t, bundle, "plain.txt")
	if file.Before != "keep\nold" || file.After != "keep\nnew" {
		t.Fatalf("file = %+v", file)
	}
}

func TestBinaryIsSkipped(t *testing.T) {
	raw := `diff --git a/logo.png b/logo.png
new file mode 100644
index 0000000..1234567
Binary files /dev/null and b/logo.png differ
`
	bundle, meta := parseOne(t, raw)
	if len(bundle.Files) != 0 {
		t.Fatalf("files = %+v", bundle.Files)
	}
	if len(meta.Skipped) != 1 || meta.Skipped[0] != "logo.png" {
		t.Fatalf("skipped = %+v", meta.Skipped)
	}
	if len(bundle.Skipped) != 1 || bundle.Skipped[0] != "logo.png" {
		t.Fatalf("bundle skipped = %+v", bundle.Skipped)
	}
}

func TestMalformedHunkFails(t *testing.T) {
	raw := `diff --git a/x.go b/x.go
--- a/x.go
+++ b/x.go
@@ -1,3 +1,3 @@
 only-one
`
	if _, _, err := Parse([]byte(raw)); err == nil {
		t.Fatal("expected a hunk count error")
	}
}

func TestEmptyInputHasEmptyLists(t *testing.T) {
	bundle, meta, err := Parse(nil)
	if err != nil {
		t.Fatal(err)
	}
	if bundle.Files == nil || bundle.Skipped == nil || meta.Skipped != nil {
		t.Fatalf("bundle = %+v meta = %+v", bundle, meta)
	}
}

func TestFormatPatchCommitHeader(t *testing.T) {
	raw := `From 0123456789abcdef0123456789abcdef01234567 Mon Sep 17 00:00:00 2001
Subject: [PATCH] fix

diff --git a/x.go b/x.go
--- a/x.go
+++ b/x.go
@@ -1 +1 @@
-old
+new
`
	_, meta := parseOne(t, raw)
	if meta.Commit != "0123456789abcdef0123456789abcdef01234567" {
		t.Fatalf("commit = %q", meta.Commit)
	}
}
