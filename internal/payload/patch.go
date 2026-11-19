package payload

import (
	"github.com/wlingze/intentflow/internal/contract"
	"github.com/wlingze/intentflow/internal/patch"
)

// BuildPatch turns a unified diff into the same code bundle as a directory
// comparison. Files keep their patch status; oversized files drop their body
// exactly like Build does.
func BuildPatch(data []byte, label string) (contract.CodeBundle, error) {
	parsed, err := patch.Parse(data)
	if err != nil {
		return contract.CodeBundle{}, err
	}
	sizes := make([]int, len(parsed.Files))
	for index, file := range parsed.Files {
		sizes[index] = len(file.Before) + len(file.After)
	}
	keep := allocate(sizes, MaxTotalBytes)
	bundle := contract.CodeBundle{Root: label, Files: make([]contract.CodeFile, 0, len(parsed.Files)), Skipped: []string{}}
	for index, file := range parsed.Files {
		status := contract.CodeStatusModified
		switch file.Status {
		case patch.Added:
			status = contract.CodeStatusAdded
		case patch.Removed:
			status = contract.CodeStatusRemoved
		case patch.Renamed:
			status = contract.CodeStatusRenamed
		case patch.Unchanged:
			status = contract.CodeStatusUnchanged
		}
		code := contract.CodeFile{
			Path:     file.Path,
			Status:   status,
			Language: languageOf(file.Path),
		}
		if file.Binary {
			code.Language = "binary"
		}
		if file.OldPath != "" {
			old := file.OldPath
			code.OldPath = &old
		}
		if !keep[index] {
			bundle.Truncated = true
			bundle.Skipped = append(bundle.Skipped, file.Path)
		} else {
			code.Before = file.Before
			code.After = file.After
		}
		bundle.Files = append(bundle.Files, code)
	}
	return bundle, nil
}
