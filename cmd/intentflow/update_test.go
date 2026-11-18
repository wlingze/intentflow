package main

import (
	"bytes"
	"context"
	"errors"
	"io"
	"runtime"
	"strings"
	"testing"

	"github.com/wlingze/intentflow/internal/selfupdate"
)

type stubReleases struct{ tag string }

func (s stubReleases) Release(context.Context, string) (selfupdate.Release, error) {
	return selfupdate.Release{Tag: s.tag, Assets: []selfupdate.Asset{{Name: stubAssetName(s.tag), URL: "http://example.invalid/asset"}}}, nil
}

func stubAssetName(tag string) string {
	ext := ".tar.gz"
	if runtime.GOOS == "windows" {
		ext = ".zip"
	}
	return "intentflow_" + strings.TrimPrefix(tag, "v") + "_" + runtime.GOOS + "_" + runtime.GOARCH + ext
}

func withUpdater(t *testing.T, u *selfupdate.Updater) {
	t.Helper()
	old := newUpdater
	t.Cleanup(func() { newUpdater = old })
	newUpdater = func() *selfupdate.Updater { return u }
}

func TestUpdateCheckReturnsExitTwoWhenNewer(t *testing.T) {
	withUpdater(t, &selfupdate.Updater{
		Repo:     "acme/intentflow",
		Current:  "0.1.0",
		Out:      io.Discard,
		Releases: stubReleases{tag: "v0.2.0"},
	})
	err := runUpdate([]string{"--check", "--repo", "acme/intentflow"})
	var status *exitStatus
	if !errors.As(err, &status) || status.code != exitUpdateAvailable {
		t.Fatalf("err = %v, want exitStatus{%d}", err, exitUpdateAvailable)
	}
}

func TestUpdateCheckReturnsZeroWhenCurrent(t *testing.T) {
	withUpdater(t, &selfupdate.Updater{
		Repo:     "acme/intentflow",
		Current:  "0.2.0",
		Out:      io.Discard,
		Releases: stubReleases{tag: "v0.2.0"},
	})
	if err := runUpdate([]string{"--check", "--repo", "acme/intentflow"}); err != nil {
		t.Fatalf("err = %v", err)
	}
}

func TestHelpListsUpdateCommand(t *testing.T) {
	var out bytes.Buffer
	usageTo(&out)
	if !strings.Contains(out.String(), "intentflow update") {
		t.Fatalf("help does not mention update:\n%s", out.String())
	}
	if err := run([]string{"--help"}); err != nil {
		t.Fatalf("run(--help) = %v", err)
	}
}
