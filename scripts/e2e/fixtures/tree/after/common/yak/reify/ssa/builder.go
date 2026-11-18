package ssa

type Builder struct{ Root string }

func New() *Builder {
	return &Builder{}
}
