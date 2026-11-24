package main

import "testing"

func TestParseGithubTarget(t *testing.T) {
	target, err := parseGithubTarget("owner/repo", 4)
	if err != nil || target.owner != "owner" || target.repo != "repo" || target.number != 4 || target.full != "owner/repo" {
		t.Fatalf("target = %+v, %v", target, err)
	}
	for _, item := range []struct {
		repo   string
		number int
	}{{"owner", 4}, {"owner/repo", 0}, {"../repo", 1}, {"owner/repo/x", 1}} {
		if _, err := parseGithubTarget(item.repo, item.number); err == nil {
			t.Fatalf("accepted %q #%d", item.repo, item.number)
		}
	}
}
