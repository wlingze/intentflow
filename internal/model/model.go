// Package model 定义 intentflow 的三层语义 diff 数据模型。
//
// 核心约束：每一层的事实都带 Confidence 标注。代码里没有「意图」，
// 所以意图层永远只能是 INFERRED 或 ASSERTED，绝不能标成 EXTRACTED。
package model

import (
	"crypto/sha1"
	"encoding/hex"
	"sort"
	"strings"
)

// Confidence 表示一条结论的可信度来源。
type Confidence string

const (
	// Extracted 表示该事实在 IR/AST 里直接存在，可确定性复现。
	Extracted Confidence = "EXTRACTED"
	// Derived 表示由 IR/AST 事实经一步规则推出，规则本身是确定的。
	Derived Confidence = "DERIVED"
	// Inferred 表示 LLM 从代码语义推断，不可确定性复现。
	Inferred Confidence = "INFERRED"
	// Asserted 表示来自 PR 描述 / commit message 等人工输入。
	Asserted Confidence = "ASSERTED"
	// Unknown 表示无依据。
	Unknown Confidence = "UNKNOWN"
)

// Layer 是语义 diff 的三层。
type Layer string

const (
	// LayerProject 项目结构层：import、函数定义、包边界。
	LayerProject Layer = "project"
	// LayerLogic 逻辑结构层：函数调用边、数据流路径的形状。
	LayerLogic Layer = "logic"
	// LayerIntent 意图层：一条完整的数据流链（从来源到副作用）。
	LayerIntent Layer = "intent"
)

// Fact 是一条原子事实。Identity 在两侧必须稳定，diff 只比较 Identity。
type Fact struct {
	// Identity 是跨版本稳定的身份键，不含行号。
	Identity string `json:"identity"`
	Layer    Layer  `json:"layer"`
	// Kind 是事实类别，如 import / func / call / chain。
	Kind string `json:"kind"`
	// Title 是给人读的一行描述。
	Title string `json:"title"`
	// Detail 是补充说明，可为空。
	Detail string `json:"detail,omitempty"`

	File     string `json:"file,omitempty"`
	Line     int    `json:"line,omitempty"`
	Function string `json:"function,omitempty"`

	Confidence Confidence `json:"confidence"`

	// Path 是跨函数经过的函数名序列，仅意图层使用。
	Path []string `json:"path,omitempty"`
	// Source 是数据来源分类，仅意图层使用。
	Source string `json:"source,omitempty"`
	// Category 是副作用类别（sql/exec/file），仅意图层使用。
	Category string `json:"category,omitempty"`
	// Shape 描述数据「如何」到达副作用点：direct / format / concat / member / call。
	// 这是安全与不安全的真正分界：同样一条 http→sql 的流，direct 是参数化，
	// format/concat 是拼接。身份键必须包含它，否则最重要的改动会被 diff 吃掉。
	Shape string `json:"shape,omitempty"`
	// Snippet 是触发这条事实的代码片段。
	Snippet string `json:"snippet,omitempty"`
}

// Delta 是单层的增删。
type Delta struct {
	Added   []Fact `json:"added"`
	Removed []Fact `json:"removed"`
}

// Count 返回本层变动总数。
func (d Delta) Count() int { return len(d.Added) + len(d.Removed) }

// Empty 表示本层没有变动。
func (d Delta) Empty() bool { return len(d.Added) == 0 && len(d.Removed) == 0 }

// Review 是一次语义 diff 的完整结果。
type Review struct {
	Before string `json:"before"`
	After  string `json:"after"`

	Project Delta `json:"project"`
	Logic   Delta `json:"logic"`
	Intent  Delta `json:"intent"`

	// Signals 是从三层事实派生的 review 关注点，供 agent 消费。
	Signals []Signal `json:"signals,omitempty"`

	// Summary 是 LLM 产出的意图叙述，可为空。
	Summary *Summary `json:"summary,omitempty"`

	// Notes 记录本次运行的降级或未完成项。
	Notes []string `json:"notes,omitempty"`
}

// Signal 是一条 review 关注点。它由事实派生，不是 LLM 猜的。
type Signal struct {
	ID       string     `json:"id"`
	Severity string     `json:"severity"` // info | warn | high
	Title    string     `json:"title"`
	Detail   string     `json:"detail,omitempty"`
	// Evidence 指向 Fact.Identity，界面可据此下钻。
	Evidence   []string   `json:"evidence"`
	Confidence Confidence `json:"confidence"`
}

// Summary 是 LLM 层的输出。所有字段都是 INFERRED。
type Summary struct {
	OneLiner   string     `json:"one_liner"`
	IntentShift string    `json:"intent_shift,omitempty"`
	Points     []SummaryPoint `json:"points,omitempty"`
	Model      string     `json:"model,omitempty"`
}

// SummaryPoint 是 LLM 的一条叙述，必须挂 evidence。
type SummaryPoint struct {
	Text     string   `json:"text"`
	Evidence []string `json:"evidence"`
}

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
