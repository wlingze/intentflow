// Package prdiff builds a workbench payload from a unified diff.
//
// It is shared by the single-patch command, the static exporter and the PR
// server. The payload contract is unchanged: the patch becomes ordinary
// before/after code, so the existing frontend works without a second data
// format.
package prdiff

import (
	"fmt"

	"github.com/wlingze/intentflow/internal/contract"
	"github.com/wlingze/intentflow/internal/model"
	"github.com/wlingze/intentflow/internal/payload"
	"github.com/wlingze/intentflow/internal/reviewctx"
)

// Params describes where a patch came from. Empty fields get neutral labels.
type Params struct {
	Repository string
	Branch     string
	Before     string
	After      string
	Title      string
	Mode       contract.ComparisonMode
	Note       string
	BaseRef    string
	HeadRef    string
}

// Build returns the payload and the one-entry revision list for a patch.
func Build(data []byte, params Params) (contract.Payload, contract.RevisionList, error) {
	if params.Repository == "" {
		params.Repository = "patch"
	}
	if params.Branch == "" {
		params.Branch = "patch"
	}
	if params.Before == "" {
		params.Before = "补丁前"
	}
	if params.After == "" {
		params.After = "补丁后"
	}
	if params.Mode == "" {
		params.Mode = contract.Folder
	}
	label := params.Before + " → " + params.After
	code, err := payload.BuildPatch(data, label)
	if err != nil {
		return contract.Payload{}, contract.RevisionList{}, err
	}
	ctx := reviewctx.NewContext(params.Repository, params.Branch, params.Before, params.After, "range", "", code)
	comparison := model.Comparison{
		Mode:        params.Mode,
		BeforeLabel: params.Before,
		AfterLabel:  params.After,
		Repo:        optional(params.Repository),
		BaseRef:     optional(params.BaseRef),
		HeadRef:     optional(params.HeadRef),
		Commits:     []contract.Commit{},
		Selected:    []string{},
		Note:        params.Note,
	}
	notes := []string{}
	if params.Note != "" {
		notes = append(notes, params.Note)
	}
	review := model.Review{
		Before:     params.Before,
		After:      params.After,
		Comparison: comparison,
		Notes:      notes,
		Signals:    []model.Signal{},
		Findings:   []contract.Finding{},
		Scan:       contract.ScanState{Mode: contract.ScanModeDiff, Status: contract.ScanStatusSkipped},
	}
	subject := params.Title
	if subject == "" {
		subject = fmt.Sprintf("%d 个文件", len(code.Files))
	}
	revisions := contract.RevisionList{
		Base:    params.Before,
		Head:    params.After,
		Current: "range",
		Revisions: []contract.Revision{
			{Id: "range", Kind: contract.RevisionKindRange, Label: "补丁", Subject: subject, Files: int32(len(code.Files))},
		},
	}
	return contract.Payload{Code: code, Session: reviewctx.Empty(ctx), Review: review}, revisions, nil
}

func optional(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}
