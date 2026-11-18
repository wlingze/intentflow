package selfupdate

import (
	"os"
	"path/filepath"
	"testing"
)

func TestReplaceWindowsKeepsOldFileOnFailure(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "intentflow.exe")
	if err := os.WriteFile(target, []byte("old-binary"), 0o755); err != nil {
		t.Fatal(err)
	}
	missing := filepath.Join(dir, "not-there")
	if err := replaceWindows(target, missing); err == nil {
		t.Fatal("replaceWindows accepted a missing new binary")
	}
	got, err := os.ReadFile(target)
	if err != nil {
		t.Fatalf("rollback did not restore %s: %v", target, err)
	}
	if string(got) != "old-binary" {
		t.Fatalf("after rollback the file is %q", got)
	}
	if _, err := os.Stat(target + ".old"); !os.IsNotExist(err) {
		t.Fatalf("backup file left behind: %v", err)
	}
}

func TestReplaceWindowsFreshInstall(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "intentflow.exe")
	tmp := filepath.Join(dir, "tmp.exe")
	if err := os.WriteFile(tmp, []byte("new-binary"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := replaceWindows(target, tmp); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(target)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "new-binary" {
		t.Fatalf("target is %q", got)
	}
}
