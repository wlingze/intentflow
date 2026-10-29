package scan

import (
	"bytes"
	"fmt"
	"go/ast"
	"go/parser"
	"go/printer"
	"go/token"
	"os"
	"path/filepath"
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
// 「判定」节点。每一行是一条 scenario，列是行为阶段。

// branchInfo 是一处条件或分发。它只记录「哪个调用在哪个分支里」，
// 不试图做完整的路径敏感分析。
type branchInfo struct {
	Func       string
	File       string
	Line       int32
	Group      int32
	Kind       string // if | switch
	Cond       string
	GroupLabel string
	Branch     string // true | false | case 值
	ThenCalls  map[string]struct{}
	ElseCalls  map[string]struct{}
	ThenStart  int32
	ThenEnd    int32
	ElseStart  int32
	ElseEnd    int32
	Guard      bool
}

type funcInfo struct {
	Name      string
	File      string
	Line      int32
	Package   string
	Params    []string
	Calls     map[string]int32
	Branches  []branchInfo
	EntryKind string
}

type sideGraph struct {
	nodes     map[string]model.BehaviorNode
	edges     map[string]model.BehaviorEdge
	scenarios map[string]model.BehaviorScenario
}

// BuildBehavior 用两侧全量事实与 AST 构造行为图，再按稳定身份做 diff。
// 图完全由代码分析得到；这里没有任何 LLM 参与。
func BuildBehavior(beforeRoot, afterRoot string, review *model.Review, before, after model.FactSet) model.BehaviorGraph {
	bFuncs, _ := indexFunctions(beforeRoot)
	aFuncs, _ := indexFunctions(afterRoot)

	b := buildSide(before, bFuncs, review.Intent.Removed)
	a := buildSide(after, aFuncs, review.Intent.Added)
	return mergeBehavior(b, a)
}

func buildSide(facts model.FactSet, funcs map[string]funcInfo, changed []model.Fact) sideGraph {
	g := sideGraph{
		nodes:     map[string]model.BehaviorNode{},
		edges:     map[string]model.BehaviorEdge{},
		scenarios: map[string]model.BehaviorScenario{},
	}
	if len(changed) == 0 {
		return g
	}

	callers := buildCallers(facts)
	for _, fact := range changed {
		path := scenarioPath(fact, callers, funcs)
		if len(path) == 0 {
			continue
		}
		entry := funcs[path[0]]
		trigger := ensureTrigger(g, path[0], entry)

		effectID := behaviorEffectID(fact.Category, fact.Function)
		effect := effectNode(fact, funcs[fact.Function], effectID)

		ids := []string{trigger.Id}
		current := trigger.Id
		addNode(g, trigger)

		for index := 1; index < len(path); index++ {
			name := path[index]
			info := funcs[name]
			step := ensureTransform(g, name, info)
			addNode(g, step)

			if decision, ok := decisionFor(funcs[lastFnOr(path, index-1)], name, lastFnOr(path, index-1)); ok {
				decisionDelta := decisionNode(decision)
				addNode(g, decisionDelta)
				addEdge(g, controlEdge(decisionDelta.Id, step.Id, decision.Branch, decision.Kind))
				addEdge(g, controlEdge(current, decisionDelta.Id, "进入判定", decision.Kind))
				ids = append(ids, decisionDelta.Id)
			} else {
				addEdge(g, callEdge(current, step.Id))
			}
			ids = append(ids, step.Id)
			current = step.Id
		}

		for _, d := range effectDecisions(funcs[fact.Function], fact) {
			dn := decisionNode(d)
			addNode(g, dn)
			addEdge(g, controlEdge(current, dn.Id, "进入判定", d.Kind))
			addEdge(g, controlEdge(dn.Id, effect.Id, d.Branch, d.Kind))
			if !containsString(ids, dn.Id) {
				ids = append(ids, dn.Id)
			}
		}
		addNode(g, effect)
		addEdge(g, dataEdge(current, effect.Id, fact))
		ids = append(ids, effect.Id)

		sc := model.BehaviorScenario{
			Id:       scenarioID(trigger.Id, effect.Id),
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

func lastFnOr(path []string, index int) string {
	if index < 0 || index >= len(path) {
		return ""
	}
	return path[index]
}

func ensureTrigger(g sideGraph, name string, info funcInfo) model.BehaviorNode {
	id := "trigger:" + name
	if existing, ok := g.nodes[id]; ok {
		return existing
	}
	kind := info.EntryKind
	if kind == "" {
		kind = "内部入口"
	}
	node := model.BehaviorNode{
		Id:         id,
		Role:       model.RoleTrigger,
		Label:      name,
		Detail:     kind,
		File:       info.File,
		Line:       info.Line,
		Function:   name,
		Package:    info.Package,
		Confidence: model.Derived,
		Evidence:   []string{},
		Tags:       []string{"entry"},
		Snippet:    "func " + name,
	}
	g.nodes[id] = node
	return node
}

func ensureTransform(g sideGraph, name string, info funcInfo) model.BehaviorNode {
	id := "transform:" + name
	if existing, ok := g.nodes[id]; ok {
		return existing
	}
	node := model.BehaviorNode{
		Id:         id,
		Role:       model.RoleTransform,
		Label:      name,
		Detail:     "函数",
		File:       info.File,
		Line:       info.Line,
		Function:   name,
		Package:    info.Package,
		Confidence: model.Extracted,
		Evidence:   []string{},
		Tags:       []string{"function"},
		Snippet:    "func " + name,
	}
	g.nodes[id] = node
	return node
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
		Id:         "decision:" + b.Func + ":" + model.Identity("decision", b.Func, normalize(b.GroupLabel), fmt.Sprint(b.Group))[:8],
		Role:       model.RoleDecision,
		Label:      label,
		Detail:     b.Kind,
		File:       b.File,
		Line:       b.Line,
		Function:   b.Func,
		Confidence: model.Derived,
		Evidence:   []string{},
		Tags:       []string{b.Kind},
		Snippet:    compact(b.Cond, 140),
	}
}

func effectNode(f model.Fact, info funcInfo, id string) model.BehaviorNode {
	detail := fmt.Sprintf("%s · %s", shapeHint(f.Shape), sourceText(f.Source))
	return model.BehaviorNode{
		Id:         id,
		Role:       model.RoleEffect,
		Label:      categoryLabel(f.Category),
		Detail:     detail,
		File:       f.File,
		Line:       f.Line,
		Function:   f.Function,
		Package:    info.Package,
		Confidence: f.Confidence,
		Evidence:   []string{f.Identity},
		Tags:       []string{"sink", f.Category},
		Snippet:    f.Snippet,
		Source:     f.Source,
		Shape:      f.Shape,
		Category:   f.Category,
	}
}

func callEdge(from, to string) model.BehaviorEdge {
	return model.BehaviorEdge{
		Id:         from + ">" + to + ":call",
		From:       from,
		To:         to,
		Kind:       model.EdgeCall,
		Label:      "调用",
		Confidence: model.Extracted,
		Evidence:   []string{},
	}
}

func controlEdge(from, to, label, kind string) model.BehaviorEdge {
	return model.BehaviorEdge{
		Id:         from + ">" + to + ":control:" + label,
		From:       from,
		To:         to,
		Kind:       model.EdgeControl,
		Label:      label,
		Confidence: model.Derived,
		Evidence:   []string{},
	}
}

func dataEdge(from, to string, f model.Fact) model.BehaviorEdge {
	return model.BehaviorEdge{
		Id:         from + ">" + to + ":data:" + f.Shape + ":" + f.Source,
		From:       from,
		To:         to,
		Kind:       model.EdgeData,
		Label:      f.Shape + " · " + sourceText(f.Source),
		Shape:      f.Shape,
		Source:     f.Source,
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
	return trigger.Label + " → " + effect.Label
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

func normalize(s string) string {
	return strings.Join(strings.Fields(s), " ")
}

// buildCallers 从全量逻辑层事实里取「谁调用了谁」。
func buildCallers(facts model.FactSet) map[string][]string {
	callers := map[string][]string{}
	for _, f := range facts[model.LayerLogic] {
		parts := strings.Split(f.Title, " → ")
		if len(parts) != 2 {
			continue
		}
		from, to := strings.TrimSpace(parts[0]), strings.TrimSpace(parts[1])
		if from == "" || to == "" {
			continue
		}
		if !containsString(callers[to], from) {
			callers[to] = append(callers[to], from)
		}
	}
	return callers
}

// scenarioPath 把一条意图事实还原成「入口 → … → sink 函数」。
//
// fact.Path 是 SSA 追源时碰到的函数集合，不是调用链；直接反转会把
// 旁支函数塞进路径。真正的调用关系从逻辑层事实（AST 调用边）取。
func scenarioPath(f model.Fact, callers map[string][]string, funcs map[string]funcInfo) []string {
	path := []string{f.Function}
	for guard := 0; guard < 8; guard++ {
		first := path[0]
		next := pickCaller(first, callers, funcs, path, f.Path)
		if next == "" {
			break
		}
		path = append([]string{next}, path...)
	}
	return path
}

func pickCaller(name string, callers map[string][]string, funcs map[string]funcInfo, path, ssaPath []string) string {
	if name == "main" {
		return ""
	}
	candidates := callers[name]
	// SSA 追源碰到的函数集合可以用来消歧，但它不是调用链。
	for _, c := range candidates {
		if containsString(ssaPath, c) && !containsString(path, c) {
			return c
		}
	}
	for _, c := range candidates {
		if funcs[c].EntryKind != "" && !containsString(path, c) {
			return c
		}
	}
	for _, c := range candidates {
		if !containsString(path, c) {
			return c
		}
	}
	return ""
}

func decisionFor(info funcInfo, callee, from string) (branchInfo, bool) {
	if from == "" || info.Name == "" {
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
func effectDecisions(info funcInfo, f model.Fact) []branchInfo {
	if info.Name == "" {
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
			// if/else 是两个可选分支；只有单边 guard 才只有一个出口。
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
	// 按拓扑最长路径排阶段。边包含新增与移除两侧，这样 before 的路径
	// 也能参与排版，不会因为删除了某条边而把节点挤到第一列。
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
	// 效果节点统一贴到最右列，比较同一副作用的 before/after。
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

func behaviorEffectID(category, function string) string {
	return "effect:" + category + ":" + function
}

func containsString(list []string, value string) bool {
	for _, item := range list {
		if item == value {
			return true
		}
	}
	return false
}

func appendUnique(list []string, value string) []string {
	if value == "" || containsString(list, value) {
		return list
	}
	return append(list, value)
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

// ---- AST 索引 ----

func indexFunctions(root string) (map[string]funcInfo, error) {
	funcs := map[string]funcInfo{}
	err := filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			if p != root && behaviorSkipDir(d.Name()) {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(p, ".go") {
			return nil
		}
		fset := token.NewFileSet()
		file, err := parser.ParseFile(fset, p, nil, 0)
		if err != nil {
			return nil
		}
		rel, err := filepath.Rel(root, p)
		if err != nil {
			return nil
		}
		rel = filepath.ToSlash(rel)
		for _, decl := range file.Decls {
			fn, ok := decl.(*ast.FuncDecl)
			if !ok || fn.Body == nil {
				continue
			}
			name := fn.Name.Name
			if recv := receiverName(fn); recv != "" {
				name = recv + "." + name
			}
			params := fieldTypes(fset, fn.Type.Params)
			info := funcInfo{
				Name:      name,
				File:      rel,
				Line:      int32(fset.Position(fn.Pos()).Line),
				Package:   file.Name.Name,
				Params:    params,
				Calls:     map[string]int32{},
				EntryKind: entryKind(name, params),
			}
			ast.Inspect(fn.Body, func(n ast.Node) bool {
				call, ok := n.(*ast.CallExpr)
				if !ok {
					return true
				}
				if callee := calleeName(call.Fun); callee != "" {
					if _, exists := info.Calls[callee]; !exists {
						info.Calls[callee] = int32(fset.Position(call.Pos()).Line)
					}
				}
				return true
			})
			info.Branches = collectBranches(fn, fset, rel, name)
			funcs[name] = info
		}
		return nil
	})
	return funcs, err
}

func fieldTypes(fset *token.FileSet, fields *ast.FieldList) []string {
	if fields == nil {
		return nil
	}
	var out []string
	for _, field := range fields.List {
		if len(field.Names) == 0 {
			out = append(out, exprText(fset, field.Type))
			continue
		}
		for range field.Names {
			out = append(out, exprText(fset, field.Type))
		}
	}
	return out
}

func entryKind(name string, params []string) string {
	hasWriter, hasRequest := false, false
	for _, p := range params {
		switch p {
		case "http.ResponseWriter":
			hasWriter = true
		case "*http.Request":
			hasRequest = true
		}
	}
	if hasWriter && hasRequest {
		return "HTTP 入口"
	}
	if name == "main" {
		return "CLI 入口"
	}
	if strings.HasSuffix(name, ".ServeHTTP") {
		return "HTTP 入口"
	}
	if strings.HasPrefix(name, "Test") {
		for _, p := range params {
			if p == "*testing.T" {
				return "测试入口"
			}
		}
	}
	return ""
}

func collectBranches(fn *ast.FuncDecl, fset *token.FileSet, file, funcName string) []branchInfo {
	var out []branchInfo
	ast.Inspect(fn.Body, func(n ast.Node) bool {
		switch stmt := n.(type) {
		case *ast.IfStmt:
			line := int32(fset.Position(stmt.Pos()).Line)
			b := branchInfo{
				Func:       funcName,
				File:       file,
				Line:       line,
				Group:      line,
				Kind:       "if",
				Cond:       exprText(fset, stmt.Cond),
				GroupLabel: exprText(fset, stmt.Cond),
				Branch:     "true",
				ThenCalls:  callsInNode(stmt.Body),
				ElseCalls:  callsInNode(stmt.Else),
				ThenStart:  int32(fset.Position(stmt.Body.Lbrace).Line),
				ThenEnd:    int32(fset.Position(stmt.Body.Rbrace).Line),
				Guard:      stmt.Else == nil && blockReturns(stmt.Body),
			}
			if stmt.Else != nil {
				b.ElseStart = int32(fset.Position(stmt.Else.Pos()).Line)
				b.ElseEnd = int32(fset.Position(stmt.Else.End()).Line)
			}
			out = append(out, b)
		case *ast.SwitchStmt:
			line := int32(fset.Position(stmt.Pos()).Line)
			tag := exprText(fset, stmt.Tag)
			groupLabel := "switch"
			if tag != "" {
				groupLabel = "switch " + tag
			}
			var caseConds []string
			for _, item := range stmt.Body.List {
				cc, ok := item.(*ast.CaseClause)
				if !ok {
					continue
				}
				cond, label := tag, "default"
				if len(cc.List) > 0 {
					var labels []string
					for _, expr := range cc.List {
						labels = append(labels, exprText(fset, expr))
					}
					if tag == "" {
						cond = strings.Join(labels, " || ")
						label = "true"
						caseConds = append(caseConds, cond)
					} else {
						label = strings.Join(labels, ",")
					}
				}
				out = append(out, branchInfo{
					Func:       funcName,
					File:       file,
					Line:       int32(fset.Position(cc.Pos()).Line),
					Group:      line,
					Kind:       "switch",
					Cond:       cond,
					GroupLabel: groupLabel,
					Branch:     label,
					ThenCalls:  callsInStatements(cc.Body),
					ElseCalls:  map[string]struct{}{},
					ThenStart:  int32(fset.Position(cc.Colon).Line),
					ThenEnd:    int32(fset.Position(cc.End()).Line),
				})
			}
			if tag == "" && len(caseConds) > 0 {
				groupLabel = "switch { " + strings.Join(caseConds, " | ") + " }"
				for i := range out {
					if out[i].Group == line {
						out[i].GroupLabel = groupLabel
					}
				}
			}
		}
		return true
	})
	return out
}

func callsInNode(node ast.Node) map[string]struct{} {
	out := map[string]struct{}{}
	if node == nil {
		return out
	}
	ast.Inspect(node, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return true
		}
		if name := calleeName(call.Fun); name != "" {
			out[name] = struct{}{}
		}
		return true
	})
	return out
}

func callsInStatements(stmts []ast.Stmt) map[string]struct{} {
	out := map[string]struct{}{}
	for _, stmt := range stmts {
		for name := range callsInNode(stmt) {
			out[name] = struct{}{}
		}
	}
	return out
}

func blockReturns(body *ast.BlockStmt) bool {
	if body == nil || len(body.List) == 0 {
		return false
	}
	last := body.List[len(body.List)-1]
	if _, ok := last.(*ast.ReturnStmt); ok {
		return true
	}
	return false
}

func exprText(fset *token.FileSet, expr ast.Expr) string {
	if expr == nil {
		return ""
	}
	var buf bytes.Buffer
	if err := printer.Fprint(&buf, fset, expr); err != nil {
		return ""
	}
	return strings.TrimSpace(buf.String())
}

func behaviorSkipDir(name string) bool {
	if strings.HasPrefix(name, ".") {
		return true
	}
	switch name {
	case "node_modules", "vendor", "dist", "out", "bin", "build", "target", "__pycache__":
		return true
	}
	return false
}
