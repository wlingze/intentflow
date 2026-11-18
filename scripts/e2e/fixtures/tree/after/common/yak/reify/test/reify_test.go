//go:build ignore

package reify

func TestRun(t *testing.T) {
	if got := 1; got != 2 {
		t.Fatal(got)
	}
}
