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
