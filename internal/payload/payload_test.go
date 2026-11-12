package payload

import "testing"

func TestAllocatePrefersSmallFiles(t *testing.T) {
	// 30 的单位放不下，三个 1 应当全部保留。
	keep := allocate([]int{30, 1, 1, 1}, 10)
	want := []bool{false, true, true, true}
	for i := range want {
		if keep[i] != want[i] {
			t.Fatalf("keep[%d] = %v, want %v", i, keep[i], want[i])
		}
	}
}

func TestAllocateKeepsInputOrder(t *testing.T) {
	keep := allocate([]int{2, 9, 3}, 10)
	// 9 + 2 超限，9 跳过；2 与 3 保留。结果按输入下标返回。
	if !keep[0] || keep[1] || !keep[2] {
		t.Fatalf("keep = %v, want [true false true]", keep)
	}
}

func TestAllocateEmpty(t *testing.T) {
	if got := allocate(nil, 10); len(got) != 0 {
		t.Fatalf("allocate(nil) = %v", got)
	}
}

func mergePaths(entries []deltaEntry) []string {
	out := make([]string, 0, len(entries))
	for _, entry := range entries {
		out = append(out, entry.path+"<-"+entry.oldPath)
	}
	return out
}

func TestMergeEntriesUsesGitRenames(t *testing.T) {
	before := map[string]string{"old.go": "package a\n"}
	after := map[string]string{"new.go": "package a\n// edit\n"}
	entries := mergeEntries(before, after, map[string]string{"old.go": "new.go"})
	if len(entries) != 1 {
		t.Fatalf("entries = %v", entries)
	}
	entry := entries[0]
	if entry.path != "new.go" || entry.oldPath != "old.go" || entry.before != "package a\n" || entry.after != "package a\n// edit\n" {
		t.Fatalf("entry = %+v", entry)
	}
}

func TestMergeEntriesPairsIdenticalContent(t *testing.T) {
	before := map[string]string{"a/old.sf": "desc(\n  type: vuln\n)\n", "gone.txt": "bye\n"}
	after := map[string]string{"b/new.sf": "desc(\n  type: vuln\n)\n", "added.txt": "hi\n"}
	entries := mergeEntries(before, after, nil)
	if got := mergePaths(entries); len(got) != 3 || got[0] != "added.txt<-" || got[1] != "b/new.sf<-a/old.sf" || got[2] != "gone.txt<-" {
		t.Fatalf("entries = %v", got)
	}
}

func TestMergeEntriesKeepsUnpaired(t *testing.T) {
	before := map[string]string{"keep.go": "same\n", "gone.go": "old\n"}
	after := map[string]string{"keep.go": "changed\n", "new.go": "new\n"}
	entries := mergeEntries(before, after, nil)
	if got := mergePaths(entries); len(got) != 3 || got[0] != "gone.go<-" || got[1] != "keep.go<-" || got[2] != "new.go<-" {
		t.Fatalf("entries = %v", got)
	}
}

func TestMergeEntriesPairsRenamedIdenticalFile(t *testing.T) {
	before := map[string]string{"old/name.sf": "desc(\n)\n"}
	after := map[string]string{"new/name.sf": "desc(\n)\n"}
	entries := mergeEntries(before, after, nil)
	if len(entries) != 1 || entries[0].oldPath != "old/name.sf" || entries[0].path != "new/name.sf" {
		t.Fatalf("entries = %v", mergePaths(entries))
	}
}
