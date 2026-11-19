package patch

import (
	"strings"
	"testing"
)

func mustParse(t *testing.T, text string) *Patch {
	t.Helper()
	parsed, err := Parse([]byte(text))
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	return parsed
}

func lines(text string) []string {
	if text == "" {
		return nil
	}
	return strings.Split(text, "\n")
}

func TestParseModifiedFile(t *testing.T) {
	parsed := mustParse(t, `diff --git a/hello.txt b/hello.txt
index 1111111..2222222 100644
--- a/hello.txt
+++ b/hello.txt
@@ -1,3 +1,4 @@
 line1
-old
+new
+extra
 line3
`)
	if len(parsed.Files) != 1 {
		t.Fatalf("files = %d", len(parsed.Files))
	}
	file := parsed.Files[0]
	if file.Path != "hello.txt" || file.Status != Modified {
		t.Fatalf("file = %+v", file)
	}
	if got := lines(file.Before); len(got) != 3 || got[1] != "old" || got[2] != "line3" {
		t.Fatalf("before = %q", file.Before)
	}
	if got := lines(file.After); len(got) != 4 || got[1] != "new" || got[2] != "extra" {
		t.Fatalf("after = %q", file.After)
	}
}

func TestParseKeepsAbsoluteLineNumbers(t *testing.T) {
	parsed := mustParse(t, `--- a/file.go
+++ b/file.go
@@ -1,2 +1,2 @@
 a
-b
+B
@@ -10,2 +10,3 @@ func later() {
 j
+k
 l
`)
	file := parsed.Files[0]
	before := lines(file.Before)
	after := lines(file.After)
	if len(before) != 11 || len(after) != 12 {
		t.Fatalf("lengths = %d/%d", len(before), len(after))
	}
	if before[0] != "a" || before[1] != "b" || before[8] != "" || before[9] != "j" {
		t.Fatalf("before pads = %#v", before)
	}
	if after[9] != "j" || after[10] != "k" || after[11] != "l" {
		t.Fatalf("after pads = %#v", after)
	}
}

func TestParseAddedDeletedAndRename(t *testing.T) {
	parsed := mustParse(t, `diff --git a/new.txt b/new.txt
new file mode 100644
--- /dev/null
+++ b/new.txt
@@ -0,0 +1,2 @@
+one
+two
diff --git a/old.txt b/old.txt
deleted file mode 100644
--- a/old.txt
+++ /dev/null
@@ -1,1 +0,0 @@
-gone
diff --git a/from.txt b/to.txt
similarity index 80%
rename from from.txt
rename to to.txt
--- a/from.txt
+++ b/to.txt
@@ -1,2 +1,2 @@
 keep
-old
+new
`)
	if len(parsed.Files) != 3 {
		t.Fatalf("files = %+v", parsed.Files)
	}
	byPath := map[string]File{}
	for _, file := range parsed.Files {
		byPath[file.Path] = file
	}
	if added := byPath["new.txt"]; added.Status != Added || added.Before != "" || added.After != "one\ntwo" {
		t.Fatalf("added = %+v", added)
	}
	if removed := byPath["old.txt"]; removed.Status != Removed || removed.Before != "gone" || removed.After != "" {
		t.Fatalf("removed = %+v", removed)
	}
	renamed := byPath["to.txt"]
	if renamed.Status != Renamed || renamed.OldPath != "from.txt" || renamed.Before != "keep\nold" || renamed.After != "keep\nnew" {
		t.Fatalf("renamed = %+v", renamed)
	}
}

func TestMergeCommitSeries(t *testing.T) {
	parsed := mustParse(t, `From 1111111111111111111111111111111111111111 Mon Sep 17 00:00:00 2001
Subject: [PATCH 1/3] add file

diff --git a/app.go b/app.go
new file mode 100644
--- /dev/null
+++ b/app.go
@@ -0,0 +1,3 @@
+package app
+
+var value = 1
From 2222222222222222222222222222222222222222 Mon Sep 17 00:00:00 2001
Subject: [PATCH 2/3] edit file

diff --git a/app.go b/app.go
--- a/app.go
+++ b/app.go
@@ -1,3 +1,4 @@
 package app
 
-var value = 1
+var value = 2
+var other = 3
From 3333333333333333333333333333333333333333 Mon Sep 17 00:00:00 2001
Subject: [PATCH 3/3] rename file

diff --git a/app.go b/main.go
similarity index 90%
rename from app.go
rename to main.go
--- a/app.go
+++ b/main.go
@@ -1,4 +1,4 @@
 package app
 
-var value = 2
+var value = 4
 var other = 3
`)
	if len(parsed.Files) != 1 {
		t.Fatalf("files = %+v", parsed.Files)
	}
	file := parsed.Files[0]
	if file.Path != "main.go" || file.OldPath != "" || file.Status != Added {
		t.Fatalf("merged identity = %+v", file)
	}
	if file.Before != "" {
		t.Fatalf("before = %q", file.Before)
	}
	want := "package app\n\nvar value = 4\nvar other = 3"
	if file.After != want {
		t.Fatalf("after = %q, want %q", file.After, want)
	}
	if len(parsed.Subjects) != 3 || parsed.Subjects[0] != "add file" {
		t.Fatalf("subjects = %#v", parsed.Subjects)
	}
}

func TestParseQuotedAndPlainPaths(t *testing.T) {
	parsed := mustParse(t, `diff --git "a/dir/with space.txt" "b/dir/with space.txt"
--- "a/dir/with space.txt"
+++ "b/dir/with space.txt"
@@ -1 +1 @@
-old
+new
`)
	if parsed.Files[0].Path != "dir/with space.txt" {
		t.Fatalf("path = %q", parsed.Files[0].Path)
	}

	plain := mustParse(t, `--- old/name.txt	2026-01-01 00:00:00
+++ new/name.txt	2026-01-01 00:00:00
@@ -1 +1 @@
-a
+b
`)
	if plain.Files[0].Path != "new/name.txt" {
		t.Fatalf("plain path = %q", plain.Files[0].Path)
	}
}

func TestParseRejectsBadHunkCount(t *testing.T) {
	_, err := Parse([]byte(`--- a/x
+++ b/x
@@ -1,2 +1,2 @@
 only one line
`))
	if err == nil {
		t.Fatalf("err = %v", err)
	}
}

func TestParseEmpty(t *testing.T) {
	if _, err := Parse(nil); err != ErrEmpty {
		t.Fatalf("err = %v", err)
	}
}

func TestApplyInsertionAndReplacement(t *testing.T) {
	base := "a\nb\nc"
	hunks := []Hunk{
		{OldStart: 2, OldLines: 1, NewStart: 2, NewLines: 2, Lines: []Line{{Kind: '-', Text: "b"}, {Kind: '+', Text: "B"}, {Kind: '+', Text: "b2"}}},
		{OldStart: 3, OldLines: 1, NewStart: 4, NewLines: 1, Lines: []Line{{Kind: '-', Text: "c"}, {Kind: '+', Text: "C"}}},
	}
	got, err := Apply(base, hunks)
	if err != nil {
		t.Fatal(err)
	}
	if got != "a\nB\nb2\nC" {
		t.Fatalf("got = %q", got)
	}
}

func TestPreambleDashLineIsNotAFile(t *testing.T) {
	parsed := mustParse(t, `From 1111111111111111111111111111111111111111 Mon Sep 17 00:00:00 2001
Subject: [PATCH] real change

--- note in the commit message
This line is not a path pair.

diff --git a/a.txt b/a.txt
--- a/a.txt
+++ b/a.txt
@@ -1 +1 @@
-a
+b
`)
	if len(parsed.Files) != 1 || parsed.Files[0].Path != "a.txt" {
		t.Fatalf("files = %+v", parsed.Files)
	}
}

func TestBinaryAddedFileKeepsAddedStatus(t *testing.T) {
	parsed := mustParse(t, `diff --git a/logo.png b/logo.png
new file mode 100644
index 0000000..1111111
Binary files /dev/null and b/logo.png differ
`)
	file := parsed.Files[0]
	if file.Status != Added || !file.Binary || file.Path != "logo.png" {
		t.Fatalf("file = %+v", file)
	}
}
