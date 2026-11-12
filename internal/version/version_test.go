package version

import (
	"runtime"
	"strings"
	"testing"
)

func TestStringIncludesBuildIdentity(t *testing.T) {
	Version, Commit, Date = "0.1.0", "abc1234", "2026-11-13"
	got := String()
	for _, want := range []string{"0.1.0", "abc1234", "2026-11-13", runtime.GOOS + "/" + runtime.GOARCH} {
		if !strings.Contains(got, want) {
			t.Fatalf("%q missing %q", got, want)
		}
	}
}
