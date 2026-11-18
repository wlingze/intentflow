package selfupdate

import "testing"

func TestCompareVersions(t *testing.T) {
	cases := []struct {
		a, b string
		want int
	}{
		{"0.1.0", "0.1.0", 0},
		{"v0.1.0", "0.2.0", -1},
		{"0.2.0", "v0.1.9", 1},
		{"1.10.0", "1.9.0", 1},
		{"1.0.0", "1.0.0-rc.1", 1},
		{"1.0.0-rc.1", "1.0.0-rc.2", -1},
		{"1.0.0-alpha", "1.0.0-alpha.1", -1},
		{"1.0.0-alpha.1", "1.0.0-alpha.beta", -1},
		{"1.0.0-beta.11", "1.0.0-beta.2", 1},
		{"1.0.0+build.7", "1.0.0", 0},
	}
	for _, c := range cases {
		a, err := parseVersion(c.a)
		if err != nil {
			t.Fatalf("parse %q: %v", c.a, err)
		}
		b, err := parseVersion(c.b)
		if err != nil {
			t.Fatalf("parse %q: %v", c.b, err)
		}
		if got := a.Compare(b); got != c.want {
			t.Errorf("%s vs %s = %d, want %d", c.a, c.b, got, c.want)
		}
	}
}

func TestParseVersionRejectsDevelopmentBuilds(t *testing.T) {
	for _, s := range []string{"dev", "none", "abc1234", "v0.1", "v0.1.0.1", "v1.x.0", ""} {
		if _, err := parseVersion(s); err == nil {
			t.Errorf("parseVersion(%q) accepted a non-release version", s)
		}
	}
}

func TestNormalizeTag(t *testing.T) {
	for _, c := range []struct{ in, want string }{
		{"0.2.0", "v0.2.0"},
		{"v0.2.0", "v0.2.0"},
		{" v0.2.0-rc.1 ", "v0.2.0-rc.1"},
	} {
		got, err := normalizeTag(c.in)
		if err != nil {
			t.Fatalf("normalizeTag(%q): %v", c.in, err)
		}
		if got != c.want {
			t.Errorf("normalizeTag(%q) = %q, want %q", c.in, got, c.want)
		}
	}
	if _, err := normalizeTag("latest"); err == nil {
		t.Error("normalizeTag accepted a non-version tag")
	}
}

func TestAssetNamesMatchReleaseWorkflow(t *testing.T) {
	cases := []struct {
		goos, goarch, want string
	}{
		{"linux", "amd64", "intentflow_0.2.0_linux_amd64.tar.gz"},
		{"linux", "arm64", "intentflow_0.2.0_linux_arm64.tar.gz"},
		{"darwin", "amd64", "intentflow_0.2.0_darwin_amd64.tar.gz"},
		{"darwin", "arm64", "intentflow_0.2.0_darwin_arm64.tar.gz"},
		{"windows", "amd64", "intentflow_0.2.0_windows_amd64.zip"},
		{"windows", "arm64", "intentflow_0.2.0_windows_arm64.zip"},
	}
	for _, c := range cases {
		got, err := assetName("v0.2.0", c.goos, c.goarch)
		if err != nil {
			t.Fatalf("assetName(%s/%s): %v", c.goos, c.goarch, err)
		}
		if got != c.want {
			t.Errorf("assetName(%s/%s) = %q, want %q", c.goos, c.goarch, got, c.want)
		}
	}
	if _, err := assetName("v0.2.0", "freebsd", "amd64"); err == nil {
		t.Error("assetName accepted an unpublished platform")
	}
}
