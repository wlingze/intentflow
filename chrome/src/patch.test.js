import test from 'node:test';
import assert from 'node:assert/strict';
import { indexPatch, parsePatch } from './patch.js';

const lines = (text) => (text === '' ? [] : text.split('\n'));

test('modified file keeps before and after', () => {
  const parsed = parsePatch(`diff --git a/hello.txt b/hello.txt
index 1111111..2222222 100644
--- a/hello.txt
+++ b/hello.txt
@@ -1,3 +1,4 @@
 line1
-old
+new
+extra
 line3
`);
  assert.equal(parsed.files.length, 1);
  const file = parsed.files[0];
  assert.equal(file.path, 'hello.txt');
  assert.equal(file.status, 'modified');
  assert.deepEqual(lines(file.before), ['line1', 'old', 'line3']);
  assert.deepEqual(lines(file.after), ['line1', 'new', 'extra', 'line3']);
});

test('hunks keep absolute line numbers', () => {
  const file = parsePatch(`--- a/file.go
+++ b/file.go
@@ -1,2 +1,2 @@
 a
-b
+B
@@ -10,2 +10,3 @@ func later() {
 j
+k
 l
`).files[0];
  const before = lines(file.before);
  const after = lines(file.after);
  assert.equal(before.length, 11);
  assert.equal(after.length, 12);
  assert.equal(before[8], '');
  assert.equal(before[9], 'j');
  assert.equal(after[9], 'j');
  assert.equal(after[10], 'k');
  assert.equal(after[11], 'l');
});

test('added, deleted and renamed files', () => {
  const parsed = parsePatch(`diff --git a/new.txt b/new.txt
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
@@ -1 +0,0 @@
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
`);
  const byPath = Object.fromEntries(parsed.files.map((file) => [file.path, file]));
  assert.equal(byPath['new.txt'].status, 'added');
  assert.equal(byPath['new.txt'].before, '');
  assert.equal(byPath['new.txt'].after, 'one\ntwo');
  assert.equal(byPath['old.txt'].status, 'removed');
  assert.equal(byPath['old.txt'].after, '');
  assert.equal(byPath['to.txt'].status, 'renamed');
  assert.equal(byPath['to.txt'].oldPath, 'from.txt');
  assert.equal(byPath['to.txt'].after, 'keep\nnew');
});

test('a commit series merges per path', () => {
  const source = `From 1111111111111111111111111111111111111111 Mon Sep 17 00:00:00 2001
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
@@BLANK@@
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
@@BLANK@@
-var value = 2
+var value = 4
 var other = 3
`;
  const parsed = parsePatch(source.replaceAll('@@BLANK@@', ' '));
  assert.equal(parsed.files.length, 1);
  assert.equal(parsed.files[0].path, 'main.go');
  assert.equal(parsed.files[0].status, 'added');
  assert.equal(parsed.files[0].after, 'package app\n\nvar value = 4\nvar other = 3');
  assert.deepEqual(parsed.subjects, ['add file', 'edit file', 'rename file']);
});

test('quoted paths and plain paths', () => {
  const quoted = parsePatch(`diff --git "a/dir/with space.txt" "b/dir/with space.txt"
--- "a/dir/with space.txt"
+++ "b/dir/with space.txt"
@@ -1 +1 @@
-old
+new
`);
  assert.equal(quoted.files[0].path, 'dir/with space.txt');
  const plain = parsePatch(`--- old/name.txt\t2026-01-01 00:00:00
+++ new/name.txt\t2026-01-01 00:00:00
@@ -1 +1 @@
-a
+b
`);
  assert.equal(plain.files[0].path, 'new/name.txt');
});

test('bad hunk counts fail', () => {
  assert.throws(() => parsePatch(`--- a/x
+++ b/x
@@ -1,2 +1,2 @@
 only one line
`));
});

test('indexPatch exposes only hunk ranges', () => {
  const parsed = parsePatch(`--- a/x
+++ b/x
@@ -1,2 +1,2 @@
 a
-b
+B
@@ -10,1 +10,1 @@
-j
+J
`);
  const ranges = indexPatch(parsed.files).get('x');
  assert.deepEqual(ranges.old, [{ start: 1, end: 2 }, { start: 10, end: 10 }]);
  assert.deepEqual(ranges.new, [{ start: 1, end: 2 }, { start: 10, end: 10 }]);
});
