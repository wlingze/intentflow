package scan

import (
	"fmt"
	"sort"
	"strings"

	"github.com/yaklang/intentflow/internal/model"
)

// 行为视图把「事实」投影成高级开发者能读的四个角色：
//
//	触发 trigger    外部刺激进入系统的位置（HTTP / CLI / 定时 / 测试）
//	判定 decision   选择走哪条行为的条件或分发
//	变换 transform  数据被构造、解析、传递的步骤
//	效果 effect     可观察的副作用（SQL / 文件 / 进程 / 响应）
//
// 这不是调用图。一个函数可以只出现在「变换」里；一个 if 可以单独成为
// 「判定」节点。每一行是一条 scenario，列是这条 scenario 自己的步骤。
//
// 关键约束：不同 scenario 之间不连边。同一个触发函数可以出现在两条
// scenario 的开头，但一条 scenario 的判定不能连到另一条 scenario 的步骤。
// 旧版把所有节点按全局阶段排成一列，才会把 handleSearch 的守卫画到
// loadTemplate 旁边，看起来像一条分叉；这是排版错误，不是代码错误。

type branchInfo struct {
	Func       string
	File       string
	Line       int32
	Group      int32
	Kind       string // if | switch
	Cond       string
	GroupLabel string
	Branch     string // true | false | case 值 | default
	ThenCalls  map[string]struct{}
	ElseCalls  map[string]struct{}
	ThenStart  int32
	ThenEnd    int32
	ElseStart  int32
	ElseEnd    int32
	Guard      bool
}

type sideGraph struct {
	nodes     map[string]model.BehaviorNode
	edges     map[string]model.BehaviorEdge
	scenarios map[string]model.BehaviorScenario
}

// BuildBehavior 用两侧 SSA 索引与意图 diff 构造行为图。
// 图完全由 SSA + SyntaxFlow 得到；这里没有任何 LLM 参与。
//
// 行为图只展示改动涉及的 scenario，但改动路径上的触发、变换、副作用
// 仍要和 before 对齐。否则一个没变过的入口函数也会被标成「新增」。
// before 侧因此先取全部意图事实建图，再按 after 的触发函数过滤；
// after 侧只取新增事实，避免把无关行为带进来。
func BuildBehavior(beforeIdx, afterIdx *IRIndex, beforeFacts []model.Fact, review *model.Review) model.BehaviorGraph {
	a := buildSide(afterIdx, review.Intent.Added)
	removed := buildSide(beforeIdx, review.Intent.Removed)
	allBefore := buildSide(beforeIdx, beforeFacts)

	keep := map[string]bool{}
	for _, s := range a.scenarios {
		keep[s.Trigger] = true
	}
	for _, s := range removed.scenarios {
		keep[s.Trigger] = true
	}
	b := filterSideByTriggers(allBefore, keep)
	return mergeBehavior(b, a)
}

// IntentFacts 返回一侧全部意图事实，供行为图对齐 before 上下文。
func IntentFacts(set model.FactSet) []model.Fact {
	out := make([]model.Fact, 0, len(set[model.LayerIntent]))
	for _, f := range set[model.LayerIntent] {
		out = append(out, f)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Identity < out[j].Identity })
	return out
}

// filterSideByTriggers 只保留指定触发函数下的 scenario 与它们引用的节点、边。
func filterSideByTriggers(g sideGraph, keep map[string]bool) sideGraph {
	out := sideGraph{
		nodes:     map[string]model.BehaviorNode{},
		edges:     map[string]model.BehaviorEdge{},
		scenarios: map[string]model.BehaviorScenario{},
	}
	for id, s := range g.scenarios {
		if !keep[s.Trigger] {
			continue
		}
		out.scenarios[id] = s
		for _, nodeID := range s.Nodes {
			if n, ok := g.nodes[nodeID]; ok {
				out.nodes[nodeID] = n
			}
		}
		if n, ok := g.nodes[s.Trigger]; ok {
			out.nodes[s.Trigger] = n
		}
	}
	for id, e := range g.edges {
		if _, ok := out.scenarios[e.Scenario]; ok {
			out.edges[id] = e
		}
	}
	return out
}

func buildSide(idx *IRIndex, changed []model.Fact) sideGraph {
	g := sideGraph{
		nodes:     map[string]model.BehaviorNode{},
		edges:     map[string]model.BehaviorEdge{},
		scenarios: map[string]model.BehaviorScenario{},
	}
	if idx == nil || len(changed) == 0 {
		return g
	}

	callers := idx.Callers()
	for _, fact := range changed {
		path := scenarioPath(fact, callers, idx)
		if len(path) == 0 {
			continue
		}
		triggerInfo := path[0]
		effectInfo, ok := idx.FuncAt(fact.Function, fact.File)
		if !ok {
			effectInfo = IRFunc{Short: fact.Function, File: fact.File, Line: fact.Line}
		}

		trigger := ensureTrigger(path[0].Short, triggerInfo)
		effect := effectNode(fact, effectInfo)
		scenarioKey := scenarioID(trigger.Id, effect.Id)

		addNode(g, trigger)
		ids := []string{trigger.Id}
		current := trigger.Id

		for index := 1; index < len(path); index++ {
			info := path[index]
			name := info.Short
			if name == "" {
				continue
			}
			step := ensureTransform(name, info)
			addNode(g, step)

			prevInfo := path[index-1]
			prevName := prevInfo.Short
			// 调用关系与分支关系是两件事：handleSearch 在守卫之前仍然调用 findUser。
			// 先保留 call 边，再叠加 control 边，避免新增守卫被误报成「调用被删除」。
			addEdge(g, callEdge(current, step.Id, scenarioKey))
			if decision, ok := decisionFor(prevInfo, name, prevName); ok {
				decisionDelta := decisionNode(decision)
				decisionDelta.Stage = 0
				addNode(g, decisionDelta)
				addEdge(g, controlEdge(current, decisionDelta.Id, "进入判定", decision.Kind, scenarioKey))
				addEdge(g, controlEdge(decisionDelta.Id, step.Id, decision.Branch, decision.Kind, scenarioKey))
				if !containsString(ids, decisionDelta.Id) {
					ids = append(ids, decisionDelta.Id)
				}
			}
			if !containsString(ids, step.Id) {
				ids = append(ids, step.Id)
			}
			current = step.Id
		}

		for _, d := range effectDecisions(effectInfo, fact) {
			dn := decisionNode(d)
			addNode(g, dn)
			addEdge(g, controlEdge(current, dn.Id, "进入判定", d.Kind, scenarioKey))
			addEdge(g, controlEdge(dn.Id, effect.Id, d.Branch, d.Kind, scenarioKey))
			if !containsString(ids, dn.Id) {
				ids = append(ids, dn.Id)
			}
		}
		addNode(g, effect)
		addEdge(g, dataEdge(current, effect.Id, fact, scenarioKey))
		if !containsString(ids, effect.Id) {
			ids = append(ids, effect.Id)
		}

		sc := model.BehaviorScenario{
			Id:       scenarioKey,
			Trigger:  trigger.Id,
			Effect:   effect.Id,
			Title:    scenarioTitle(trigger, effect),
			Nodes:    ids,
			Source:   fact.Source,
			Shape:    fact.Shape,
			Category: fact.Category,
		}
		if old, ok := g.scenarios[sc.Id]; ok {
			if len(old.Nodes) < len(sc.Nodes) {
				g.scenarios[sc.Id] = sc
			}
		} else {
			g.scenarios[sc.Id] = sc
		}
	}
	return g
}

func ensureTrigger(name string, info IRFunc) model.BehaviorNode {
	id := behaviorNodeID("trigger", name, info.File)
	kind := info.EntryKind
	if kind == "" {
		kind = "内部入口"
	}
	if base := baseFileName(info.File); base != "" {
		kind += " · " + base
	}
	return model.BehaviorNode{
		Id:         id,
		Role:       model.RoleTrigger,
		Label:      name,
		Detail:     kind,
		File:       info.File,
		Line:       info.Line,
		Function:   name,
		Package:    filepathPackage(info.File),
		Confidence: model.Derived,
		Evidence:   []string{},
		Tags:       []string{"entry"},
		Snippet:    "func " + name,
	}
}

func ensureTransform(name string, info IRFunc) model.BehaviorNode {
	id := behaviorNodeID("transform", name, info.File)
	return model.BehaviorNode{
		Id:         id,
		Role:       model.RoleTransform,
		Label:      name,
		Detail:     "函数",
		File:       info.File,
		Line:       info.Line,
		Function:   name,
		Package:    filepathPackage(info.File),
		Confidence: model.Extracted,
		Evidence:   []string{},
		Tags:       []string{"function"},
		Snippet:    "func " + name,
	}
}

func decisionNode(b branchInfo) model.BehaviorNode {
	label := compact(b.GroupLabel, 80)
	if label == "" {
		label = compact(b.Cond, 80)
	}
	if label == "" {
		label = "其他输入"
	}
	return model.BehaviorNode{
		Id:         behaviorNodeID("decision", b.Func, b.File) + ":" + model.Identity("decision", b.Func, normalize(b.GroupLabel), fmt.Sprint(b.Group))[:8],
		Role:       model.RoleDecision,
		Label:      label,
		Detail:     b.Kind,
		File:       b.File,
		Line:       b.Line,
		Function:   b.Func,
		Package:    filepathPackage(b.File),
		Confidence: model.Derived,
		Evidence:   []string{},
		Tags:       []string{b.Kind},
		Snippet:    compact(b.Cond, 140),
	}
}

func effectNode(f model.Fact, info IRFunc) model.BehaviorNode {
	detail := fmt.Sprintf("%s · %s", shapeHint(f.Shape), sourceText(f.Source))
	return model.BehaviorNode{
		Id:         behaviorEffectID(f.Category, f.Function, f.File),
		Role:       model.RoleEffect,
		Label:      categoryLabel(f.Category),
		Detail:     detail,
		File:       f.File,
		Line:       f.Line,
		Function:   f.Function,
		Package:    filepathPackage(info.File),
		Confidence: f.Confidence,
		Evidence:   []string{f.Identity},
		Tags:       []string{"sink", f.Category},
		Snippet:    f.Snippet,
		Source:     f.Source,
		Shape:      f.Shape,
		Category:   f.Category,
	}
}

func callEdge(from, to, scenario string) model.BehaviorEdge {
	return model.BehaviorEdge{
		Id:         from + ">" + to + ":call:" + scenario,
		From:       from,
		To:         to,
		Kind:       model.EdgeCall,
		Label:      "调用",
		Scenario:   scenario,
		Confidence: model.Extracted,
		Evidence:   []string{},
	}
}

func controlEdge(from, to, label, kind, scenario string) model.BehaviorEdge {
	return model.BehaviorEdge{
		Id:         from + ">" + to + ":control:" + label + ":" + scenario,
		From:       from,
		To:         to,
		Kind:       model.EdgeControl,
		Label:      label,
		Scenario:   scenario,
		Confidence: model.Derived,
		Evidence:   []string{},
	}
}

func dataEdge(from, to string, f model.Fact, scenario string) model.BehaviorEdge {
	return model.BehaviorEdge{
		Id:         from + ">" + to + ":data:" + f.Shape + ":" + f.Source + ":" + scenario,
		From:       from,
		To:         to,
		Kind:       model.EdgeData,
		Label:      f.Shape + " · " + sourceText(f.Source),
		Shape:      f.Shape,
		Source:     f.Source,
		Scenario:   scenario,
		Confidence: model.Derived,
		Evidence:   []string{f.Identity},
	}
}

func addNode(g sideGraph, n model.BehaviorNode) {
	if _, ok := g.nodes[n.Id]; !ok {
		g.nodes[n.Id] = n
	}
}

func addEdge(g sideGraph, e model.BehaviorEdge) {
	if _, ok := g.edges[e.Id]; !ok {
		g.edges[e.Id] = e
	}
}

func scenarioID(trigger, effect string) string {
	return "scenario:" + trigger + ":" + effect
}

func scenarioTitle(trigger, effect model.BehaviorNode) string {
	if effect.Label == "" {
		return trigger.Label
	}
	title := trigger.Label + " → " + effect.Label
	if effect.Function != "" {
		title += " · " + effect.Function
	}
	return title
}

func categoryLabel(category string) string {
	switch category {
	case "sql":
		return "SQL 执行"
	case "exec":
		return "进程执行"
	case "file":
		return "文件读写"
	case "http":
		return "HTTP 调用"
	case "env":
		return "环境变量"
	}
	if category == "" {
		return "效果"
	}
	return category
}

func sourceText(source string) string {
	if source == "" {
		return "未知来源"
	}
	return source
}

func baseFileName(file string) string {
	if i := strings.LastIndex(file, "/"); i >= 0 {
		return file[i+1:]
	}
	return file
}

func filepathPackage(file string) string {
	if i := strings.LastIndex(file, "/"); i >= 0 {
		return file[:i]
	}
	return ""
}

// scenarioPath 把一条意图事实还原成「入口 → … → sink 函数」。
//
// fact.Path 是 SSA 追源时碰到的函数集合，不是调用链；直接反转会把
// 旁支函数塞进路径。真正的调用关系从 SSA 调用边取。
func scenarioPath(f model.Fact, callers map[string][]IRFunc, idx *IRIndex) []IRFunc {
	first, ok := idx.FuncAt(f.Function, f.File)
	if !ok {
		return nil
	}
	path := []IRFunc{first}
	for guard := 0; guard < 12; guard++ {
		next, ok := pickCaller(path[0], callers, path, f.Path)
		if !ok {
			break
		}
		path = append([]IRFunc{next}, path...)
	}
	return path
}

func pickCaller(current IRFunc, callers map[string][]IRFunc, path []IRFunc, ssaPath []string) (IRFunc, bool) {
	if current.Short == "main" {
		return IRFunc{}, false
	}
	candidates := callers[current.Short]
	for _, c := range candidates {
		if containsIRFunc(path, c) {
			continue
		}
		if containsString(ssaPath, c.Short) {
			return c, true
		}
	}
	for _, c := range candidates {
		if !containsIRFunc(path, c) && c.EntryKind != "" {
			return c, true
		}
	}
	for _, c := range candidates {
		if !containsIRFunc(path, c) {
			return c, true
		}
	}
	return IRFunc{}, false
}

func containsIRFunc(list []IRFunc, value IRFunc) bool {
	for _, item := range list {
		if item.Short == value.Short && item.File == value.File {
			return true
		}
	}
	return false
}

func decisionFor(info IRFunc, callee, from string) (branchInfo, bool) {
	if from == "" || info.Short == "" {
		return branchInfo{}, false
	}
	var matches []struct {
		b      branchInfo
		branch string
	}
	for _, b := range info.Branches {
		if _, ok := b.ThenCalls[callee]; ok {
			matches = append(matches, struct {
				b      branchInfo
				branch string
			}{b, "true"})
		}
		if _, ok := b.ElseCalls[callee]; ok {
			matches = append(matches, struct {
				b      branchInfo
				branch string
			}{b, "false"})
		}
	}
	if len(matches) > 0 {
		sort.Slice(matches, func(i, j int) bool { return matches[i].b.Line < matches[j].b.Line })
		m := matches[0]
		if m.b.Kind == "if" {
			m.b.Branch = m.branch
		}
		return m.b, true
	}
	// 提前返回的 guard：只有 guard 在调用之前才挂上去。
	callLine := info.Calls[callee]
	for _, b := range info.Branches {
		if !b.Guard {
			continue
		}
		if callLine > 0 && b.Line >= callLine {
			continue
		}
		b.Branch = "继续"
		return b, true
	}
	return branchInfo{}, false
}

// effectDecisions 找出「直接影响这个副作用」的条件或分发。
// 若副作用在某个分支体内，只取那个分支；否则取紧挨在副作用前、
// 且在该函数内最后出现的一组分支（例如 switch 选完模板再执行）。
func effectDecisions(info IRFunc, f model.Fact) []branchInfo {
	if info.Short == "" {
		return nil
	}
	var inside []branchInfo
	seen := map[string]struct{}{}
	addInside := func(b branchInfo, branch string) {
		if b.Kind == "if" {
			b.Branch = branch
		}
		key := fmt.Sprintf("%s:%s", b.Func, b.Branch)
		if _, dup := seen[key]; dup {
			return
		}
		seen[key] = struct{}{}
		inside = append(inside, b)
	}
	for _, b := range info.Branches {
		if b.ThenStart > 0 && f.Line >= b.ThenStart && f.Line <= b.ThenEnd {
			addInside(b, "true")
		}
		if b.ElseStart > 0 && f.Line >= b.ElseStart && f.Line <= b.ElseEnd {
			addInside(b, "false")
		}
	}
	if len(inside) > 0 {
		return inside
	}

	group := int32(0)
	for _, b := range info.Branches {
		if b.Group < f.Line && b.Group > group {
			group = b.Group
		}
	}
	if group == 0 {
		return nil
	}
	var out []branchInfo
	for _, b := range info.Branches {
		if b.Group != group {
			continue
		}
		if b.Kind == "if" {
			out = append(out, b)
			if b.ElseCalls != nil && len(b.ElseCalls) > 0 {
				alt := b
				alt.Branch = "false"
				out = append(out, alt)
			}
			continue
		}
		out = append(out, b)
	}
	return out
}

func mergeBehavior(before, after sideGraph) model.BehaviorGraph {
	nodes := map[string]model.BehaviorNode{}
	for id, n := range before.nodes {
		n.Delta = model.DeltaRemoved
		nodes[id] = n
	}
	for id, n := range after.nodes {
		if old, ok := nodes[id]; ok {
			n.Delta = model.DeltaUnchanged
			if n.Detail != old.Detail || n.Label != old.Label || n.Source != old.Source || n.Shape != old.Shape {
				n.Delta = model.DeltaModified
				n.Change = describeChange(old, n)
			}
			n.Evidence = unionStrings(old.Evidence, n.Evidence)
			nodes[id] = n
		} else {
			n.Delta = model.DeltaAdded
			nodes[id] = n
		}
	}

	edges := map[string]model.BehaviorEdge{}
	for id, e := range before.edges {
		e.Delta = model.DeltaRemoved
		edges[id] = e
	}
	for id, e := range after.edges {
		if old, ok := edges[id]; ok {
			e.Delta = model.DeltaUnchanged
			e.Evidence = unionStrings(old.Evidence, e.Evidence)
			edges[id] = e
		} else {
			e.Delta = model.DeltaAdded
			edges[id] = e
		}
	}

	scenarios := map[string]model.BehaviorScenario{}
	for id, s := range before.scenarios {
		s.Delta = model.DeltaRemoved
		scenarios[id] = s
	}
	for id, s := range after.scenarios {
		if old, ok := scenarios[id]; ok {
			s.Delta = model.DeltaUnchanged
			if !equalStrings(old.Nodes, s.Nodes) || old.Shape != s.Shape || old.Source != s.Source {
				s.Delta = model.DeltaModified
			}
			scenarios[id] = s
		} else {
			s.Delta = model.DeltaAdded
			scenarios[id] = s
		}
	}

	graph := model.BehaviorGraph{
		Nodes:     []model.BehaviorNode{},
		Edges:     []model.BehaviorEdge{},
		Scenarios: []model.BehaviorScenario{},
	}
	for _, n := range nodes {
		graph.Nodes = append(graph.Nodes, n)
	}
	for _, e := range edges {
		graph.Edges = append(graph.Edges, e)
	}
	for _, s := range scenarios {
		graph.Scenarios = append(graph.Scenarios, s)
	}
	assignStages(&graph)
	graph.Entry = primaryEntry(graph)
	graph.Stats = behaviorStats(graph)
	sort.Slice(graph.Nodes, func(i, j int) bool {
		if graph.Nodes[i].Stage != graph.Nodes[j].Stage {
			return graph.Nodes[i].Stage < graph.Nodes[j].Stage
		}
		if graph.Nodes[i].Role != graph.Nodes[j].Role {
			return graph.Nodes[i].Role < graph.Nodes[j].Role
		}
		return graph.Nodes[i].Label < graph.Nodes[j].Label
	})
	sort.Slice(graph.Edges, func(i, j int) bool { return graph.Edges[i].Id < graph.Edges[j].Id })
	sort.Slice(graph.Scenarios, func(i, j int) bool {
		return graph.Scenarios[i].Title < graph.Scenarios[j].Title
	})
	return graph
}

func describeChange(before, after model.BehaviorNode) string {
	switch {
	case before.Shape != after.Shape && before.Shape != "" && after.Shape != "":
		return fmt.Sprintf("%s → %s", before.Shape, after.Shape)
	case before.Source != after.Source && before.Source != "" && after.Source != "":
		return fmt.Sprintf("%s → %s", before.Source, after.Source)
	case before.Label != after.Label:
		return "条件或标签变化"
	default:
		return "属性变化"
	}
}

func assignStages(g *model.BehaviorGraph) {
	stage := map[string]int32{}
	for _, n := range g.Nodes {
		stage[n.Id] = -1
		if n.Role == model.RoleTrigger {
			stage[n.Id] = 0
		}
	}
	for pass := 0; pass < len(g.Nodes)+1; pass++ {
		changed := false
		for _, e := range g.Edges {
			fs, fok := stage[e.From]
			ts, tok := stage[e.To]
			if !fok || !tok || fs < 0 {
				continue
			}
			if ts < fs+1 {
				stage[e.To] = fs + 1
				changed = true
			}
		}
		if !changed {
			break
		}
	}
	for id, value := range stage {
		if value < 0 {
			stage[id] = 0
		}
	}
	maxEffect := int32(0)
	for _, n := range g.Nodes {
		if n.Role == model.RoleEffect && stage[n.Id] > maxEffect {
			maxEffect = stage[n.Id]
		}
	}
	for i := range g.Nodes {
		if g.Nodes[i].Role == model.RoleEffect {
			g.Nodes[i].Stage = maxEffect
			continue
		}
		g.Nodes[i].Stage = stage[g.Nodes[i].Id]
	}
	maxStage := int32(0)
	for _, n := range g.Nodes {
		if n.Stage > maxStage {
			maxStage = n.Stage
		}
	}
	g.StageCount = maxStage + 1
	g.Lanes = behaviorLanes(g.Nodes)
}

func behaviorLanes(nodes []model.BehaviorNode) []model.BehaviorLane {
	counts := map[model.BehaviorRole]int32{}
	for _, n := range nodes {
		counts[n.Role]++
	}
	return []model.BehaviorLane{
		{Role: model.RoleTrigger, Label: "触发", Description: "外部刺激进入系统的位置：HTTP、CLI、定时任务或测试。", Order: 0, Count: counts[model.RoleTrigger]},
		{Role: model.RoleDecision, Label: "判定", Description: "选择走哪条行为的条件、守卫或分发。", Order: 1, Count: counts[model.RoleDecision]},
		{Role: model.RoleTransform, Label: "变换", Description: "数据被构造、解析、传递的步骤。", Order: 2, Count: counts[model.RoleTransform]},
		{Role: model.RoleEffect, Label: "效果", Description: "可观察的副作用：数据库、文件、进程、网络或响应。", Order: 3, Count: counts[model.RoleEffect]},
	}
}

func primaryEntry(g model.BehaviorGraph) string {
	counts := map[string]int{}
	for _, s := range g.Scenarios {
		counts[s.Trigger]++
	}
	best, bestCount := "", -1
	for id, count := range counts {
		if count > bestCount || (count == bestCount && id < best) {
			best, bestCount = id, count
		}
	}
	return best
}

func behaviorStats(g model.BehaviorGraph) model.BehaviorStats {
	stats := model.BehaviorStats{
		Nodes:     int32(len(g.Nodes)),
		Edges:     int32(len(g.Edges)),
		Scenarios: int32(len(g.Scenarios)),
	}
	for _, n := range g.Nodes {
		switch n.Delta {
		case model.DeltaAdded:
			stats.Added++
		case model.DeltaRemoved:
			stats.Removed++
		case model.DeltaModified:
			stats.Modified++
		}
	}
	return stats
}

func behaviorEffectID(category, function, file string) string {
	return behaviorNodeID("effect:"+category, function, file)
}

func behaviorNodeID(prefix, name, file string) string {
	return prefix + ":" + name + ":" + model.Identity("file", file)[:8]
}

func containsString(list []string, value string) bool {
	for _, item := range list {
		if item == value {
			return true
		}
	}
	return false
}

func unionStrings(a, b []string) []string {
	out := append([]string{}, a...)
	for _, value := range b {
		if !containsString(out, value) {
			out = append(out, value)
		}
	}
	return out
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
