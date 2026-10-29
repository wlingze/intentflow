// Package model 定义 intentflow 的三层语义 diff 与行为视图。
//
// 类型本身由 schema/openapi.yaml 生成（internal/contract），
// 这里只保留领域别名、身份键与 diff 逻辑。这样 Go 与 TypeScript
// 永远读同一份 JSON 契约，不再各自维护一套结构体。
package model

import (
	"crypto/sha1"
	"encoding/hex"
	"sort"
	"strings"

	"github.com/yaklang/intentflow/internal/contract"
)

// Confidence 表示一条结论的可信度来源。
type Confidence = contract.Confidence

const (
	// Extracted 表示该事实在 IR/AST 里直接存在，可确定性复现。
	Extracted = contract.EXTRACTED
	// Derived 表示由 IR/AST 事实经一步规则推出，规则本身是确定的。
	Derived = contract.DERIVED
	// Inferred 表示 LLM 从代码语义推断，不可确定性复现。
	Inferred = contract.INFERRED
	// Asserted 表示来自 PR 描述 / commit message 等人工输入。
	Asserted = contract.ASSERTED
	// Unknown 表示无依据。
	Unknown = contract.UNKNOWN
)

// Severity 是关注点等级。
type Severity = contract.Severity

const (
	High = contract.High
	Warn = contract.Warn
	Info = contract.Info
)

// Layer 是语义 diff 的三层。
type Layer = contract.Layer

const (
	// LayerProject 项目结构层：import、函数定义、包边界。
	LayerProject = contract.Project
	// LayerLogic 逻辑结构层：函数调用边、数据流路径的形状。
	LayerLogic = contract.Logic
	// LayerIntent 意图层：一条完整的数据流链（从来源到副作用）。
	LayerIntent = contract.Intent
)

// Fact 是一条原子事实。Identity 在两侧必须稳定，diff 只比较 Identity。
type Fact = contract.Fact

// Delta 是单层的增删。
type Delta = contract.Delta

// Review 是一次语义 diff 的完整结果。
type Review = contract.Review

// Signal 是一条 review 关注点。它由事实派生，不是 LLM 猜的。
type Signal = contract.Signal

// 行为视图的 JSON 类型。
type BehaviorGraph = contract.BehaviorGraph
type BehaviorNode = contract.BehaviorNode
type BehaviorEdge = contract.BehaviorEdge
type BehaviorScenario = contract.BehaviorScenario
type BehaviorLane = contract.BehaviorLane
type BehaviorRole = contract.BehaviorRole
type BehaviorEdgeKind = contract.BehaviorEdgeKind
type BehaviorStats = contract.BehaviorStats

// 行为视图的节点角色。名称来自 docs/07-behavior-model.md。
const (
	RoleTrigger   = contract.Trigger
	RoleDecision  = contract.Decision
	RoleTransform = contract.Transform
	RoleEffect    = contract.Effect
)

// 行为视图的边类别。
const (
	EdgeCall     = contract.Call
	EdgeData     = contract.Data
	EdgeControl  = contract.Control
	EdgeBoundary = contract.Boundary
)

// 变更标记。
const (
	DeltaAdded     = contract.DeltaKindAdded
	DeltaRemoved   = contract.DeltaKindRemoved
	DeltaModified  = contract.DeltaKindModified
	DeltaUnchanged = contract.DeltaKindUnchanged
)

// 代码状态与 side。
const (
	CodeAdded     = contract.CodeStatusAdded
	CodeRemoved   = contract.CodeStatusRemoved
	CodeModified  = contract.CodeStatusModified
	CodeUnchanged = contract.CodeStatusUnchanged

	SideBefore = contract.Before
	SideAfter  = contract.After
)

// DeltaCount 返回本层变动总数。
func DeltaCount(d Delta) int { return len(d.Added) + len(d.Removed) }

// DeltaEmpty 表示本层没有变动。
func DeltaEmpty(d Delta) bool { return len(d.Added) == 0 && len(d.Removed) == 0 }

// FactSet 是一侧所有事实的集合，按 Identity 索引。
type FactSet map[Layer]map[string]Fact

// NewFactSet 创建空集合。
func NewFactSet() FactSet {
	return FactSet{
		LayerProject: {},
		LayerLogic:   {},
		LayerIntent:  {},
	}
}

// Add 插入一条事实。同一 Identity 重复插入时保留先到的。
func (s FactSet) Add(f Fact) {
	m, ok := s[f.Layer]
	if !ok {
		m = map[string]Fact{}
		s[f.Layer] = m
	}
	if _, dup := m[f.Identity]; !dup {
		m[f.Identity] = f
	}
}

// Len 返回本侧某层的事实数。
func (s FactSet) Len(l Layer) int { return len(s[l]) }

// Diff 计算两侧的单层差异。只按 Identity 比较，行号变化不产生差异。
func Diff(layer Layer, before, after FactSet) Delta {
	old, cur := before[layer], after[layer]
	d := Delta{Added: []Fact{}, Removed: []Fact{}}

	for id, f := range cur {
		if _, ok := old[id]; !ok {
			d.Added = append(d.Added, f)
		}
	}
	for id, f := range old {
		if _, ok := cur[id]; !ok {
			d.Removed = append(d.Removed, f)
		}
	}

	sortFacts(d.Added)
	sortFacts(d.Removed)
	return d
}

func sortFacts(fs []Fact) {
	sort.Slice(fs, func(i, j int) bool {
		if fs[i].Layer != fs[j].Layer {
			return fs[i].Layer < fs[j].Layer
		}
		return fs[i].Identity < fs[j].Identity
	})
}

// Identity 生成稳定身份键。参数按传入顺序拼接，调用方负责保证顺序稳定。
func Identity(parts ...string) string {
	h := sha1.Sum([]byte(strings.Join(parts, "\x00")))
	return hex.EncodeToString(h[:8])
}
