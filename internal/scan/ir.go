package scan

import (
	"context"
	"fmt"
	"path/filepath"
	"sort"
	"strings"

	"github.com/yaklang/yaklang/common/yak/ssa"
	"github.com/yaklang/yaklang/common/yak/ssa_compile"
	"github.com/yaklang/yaklang/common/yak/ssaapi"
	"github.com/yaklang/yaklang/common/yak/ssaapi/ssaconfig"

	"github.com/yaklang/intentflow/internal/model"
)

// IRIndex 是一份代码库在 SSA 层的最小索引。
//
// 项目层、逻辑层、行为层都只从这里读事实，不再回头解析 Go 语法树。
// 这不是「比 AST 更高级」，而是为了一个约束：同一份代码只允许有一种
// 语义来源。SSA 已经包含函数、调用、条件、CFG 与位置，再让 AST 参与
// 就会产生两套互相矛盾的行号与调用关系。
type IRIndex struct {
	Root  string
	Files map[string]*IRFile
	Funcs map[string]*IRFunc
	Names map[string]string // short -> full
}

type IRFile struct {
	Path      string
	Functions []string
	Calls     int32
}

type IRFunc struct {
	Key       string
	Name      string
	Short     string
	File      string
	Line      int32
	Params    []string
	Calls     map[string]int32
	Branches  []branchInfo
	EntryKind string
	Anonymous bool
}

// AnalyzeSSA 编译一次代码库，返回三层事实与 IR 索引。
//
// 所有层级共享同一份 SSA：项目层是文件/函数/调用，逻辑层是跨函数调用边，
// 意图层是 SyntaxFlow 命中的 source→sink。调用 SyntaxFlow 之前先 Finish，
// 保证后续索引看到的是完整 CFG，而不是懒加载中的空函数。
func AnalyzeSSA(ctx context.Context, root, programName string) (model.FactSet, *IRIndex, []string, error) {
	set := model.NewFactSet()
	var notes []string

	cfg, err := ssaconfig.NewCLIScanConfig(
		ssaconfig.WithCodeSourceKind(ssaconfig.CodeSourceLocal),
		ssaconfig.WithCodeSourceLocalFile(root),
		ssaconfig.WithProjectRawLanguage("golang"),
		ssaconfig.WithSetProgramName(programName),
		ssaconfig.WithCompileMemoryCompile(true),
		ssaconfig.WithSyntaxFlowMemory(true),
	)
	if err != nil {
		return set, nil, notes, fmt.Errorf("构建编译配置失败: %w", err)
	}
	prog, err := ssa_compile.CompileWithConfig(ctx, cfg)
	if err != nil {
		return set, nil, notes, fmt.Errorf("SSA 编译失败: %w", err)
	}
	prog.Program.Finish()
	if errs := prog.GetErrors(); len(errs) > 0 {
		notes = append(notes, fmt.Sprintf("SSA 编译产生 %d 条诊断（多为标准库签名缺失）", len(errs)))
	}

	index := BuildIRIndex(prog, root, programName)
	mergeLayer(set, ProjectFacts(index), model.LayerProject)
	mergeLayer(set, LogicFacts(index), model.LayerLogic)

	intent, intentNotes, err := intentFacts(prog, programName)
	if err != nil {
		return set, index, notes, err
	}
	notes = append(notes, intentNotes...)
	mergeLayer(set, intent, model.LayerIntent)
	return set, index, notes, nil
}

// BuildIRIndex 遍历完整 SSA 程序，建立函数、文件、调用与分支索引。
func BuildIRIndex(prog *ssaapi.Program, root, programName string) *IRIndex {
	index := &IRIndex{
		Root:  root,
		Files: map[string]*IRFile{},
		Funcs: map[string]*IRFunc{},
		Names: map[string]string{},
	}
	if prog == nil || prog.Program == nil {
		return index
	}

	for file := range prog.Program.FileList {
		rel := relFile(root, programName, file)
		if rel == "" || !strings.HasSuffix(rel, ".go") {
			continue
		}
		index.Files[rel] = &IRFile{Path: rel}
	}

	prog.Program.EachFunction(func(fn *ssa.Function) {
		if fn == nil {
			return
		}
		name := fn.GetName()
		if name == "" || name == "@main" || name == "@virtual" || strings.HasPrefix(name, "@") {
			return
		}
		file, line := functionPosition(root, programName, fn)
		if file == "" {
			return
		}
		short := shortName(name)
		if short == "" {
			return
		}
		info := &IRFunc{
			Key:       file + ":" + fmt.Sprint(line) + ":" + name,
			Name:      name,
			Short:     short,
			File:      file,
			Line:      line,
			Params:    functionParams(fn),
			Calls:     map[string]int32{},
			Anonymous: strings.HasPrefix(name, "AnonymousFunc-"),
		}
		info.EntryKind = entryKindSSA(short, info.Params)
		info.Branches = collectSSABranches(fn, file)
		collectSSACalls(fn, info)

		if fileInfo := index.Files[file]; fileInfo != nil {
			fileInfo.Functions = append(fileInfo.Functions, short)
			fileInfo.Calls += int32(len(info.Calls))
		}
		index.Funcs[info.Key] = info
		if _, exists := index.Names[short]; !exists || (!info.Anonymous && !index.Funcs[index.Names[short]].Anonymous) {
			index.Names[short] = info.Key
		}
	})

	// 文件顺序稳定，前端目录树不需要再排序。
	for _, file := range index.Files {
		sort.Strings(file.Functions)
	}
	return index
}

// Func 按短名查找函数。短名与逻辑层事实的身份键一致。
func (idx *IRIndex) Func(name string) (IRFunc, bool) {
	if idx == nil {
		return IRFunc{}, false
	}
	key, ok := idx.Names[shortName(name)]
	if !ok {
		return IRFunc{}, false
	}
	fn, ok := idx.Funcs[key]
	if !ok {
		return IRFunc{}, false
	}
	return *fn, true
}

// FuncAt 按短名与文件精确查找函数，避免 main / Check 这类重名函数串行。
func (idx *IRIndex) FuncAt(name, file string) (IRFunc, bool) {
	if idx == nil {
		return IRFunc{}, false
	}
	short := shortName(name)
	for _, fn := range idx.Funcs {
		if fn.Short == short && fn.File == file && !fn.Anonymous {
			return *fn, true
		}
	}
	return idx.Func(short)
}

// Callers 从 SSA 调用边构造「谁调用了我」。
// 返回函数副本，保留文件路径，便于区分同名函数。
func (idx *IRIndex) Callers() map[string][]IRFunc {
	callers := map[string][]IRFunc{}
	if idx == nil {
		return callers
	}
	for _, fn := range idx.Funcs {
		if fn.Anonymous {
			continue
		}
		for callee := range fn.Calls {
			if callee == "" || callee == fn.Short {
				continue
			}
			duplicate := false
			for _, existing := range callers[callee] {
				if existing.Short == fn.Short && existing.File == fn.File {
					duplicate = true
					break
				}
			}
			if !duplicate {
				callers[callee] = append(callers[callee], *fn)
			}
		}
	}
	for name := range callers {
		sort.Slice(callers[name], func(i, j int) bool {
			if callers[name][i].File != callers[name][j].File {
				return callers[name][i].File < callers[name][j].File
			}
			return callers[name][i].Short < callers[name][j].Short
		})
	}
	return callers
}

// ProjectFacts 把 SSA 索引投影成项目层事实。
func ProjectFacts(idx *IRIndex) model.FactSet {
	set := model.NewFactSet()
	if idx == nil {
		return set
	}
	files := make([]string, 0, len(idx.Files))
	for file := range idx.Files {
		files = append(files, file)
	}
	sort.Strings(files)
	for _, file := range files {
		set.Add(model.Fact{
			Identity:   model.Identity("file", file),
			Layer:      model.LayerProject,
			Kind:       "file",
			Title:      file,
			File:       file,
			Line:       1,
			Confidence: model.Extracted,
		})
	}

	funcs := make([]*IRFunc, 0, len(idx.Funcs))
	for _, fn := range idx.Funcs {
		if fn.Anonymous {
			continue
		}
		funcs = append(funcs, fn)
	}
	sort.Slice(funcs, func(i, j int) bool {
		if funcs[i].File != funcs[j].File {
			return funcs[i].File < funcs[j].File
		}
		return funcs[i].Line < funcs[j].Line
	})
	for _, fn := range funcs {
		set.Add(model.Fact{
			Identity:   model.Identity("func", fn.Short),
			Layer:      model.LayerProject,
			Kind:       "func",
			Title:      "func " + fn.Short,
			File:       fn.File,
			Line:       fn.Line,
			Function:   fn.Short,
			Confidence: model.Extracted,
		})
	}
	return set
}

// LogicFacts 把 SSA 调用边投影成逻辑层事实。
func LogicFacts(idx *IRIndex) model.FactSet {
	set := model.NewFactSet()
	if idx == nil {
		return set
	}
	funcs := make([]*IRFunc, 0, len(idx.Funcs))
	for _, fn := range idx.Funcs {
		if fn.Anonymous {
			continue
		}
		funcs = append(funcs, fn)
	}
	sort.Slice(funcs, func(i, j int) bool {
		if funcs[i].File != funcs[j].File {
			return funcs[i].File < funcs[j].File
		}
		return funcs[i].Line < funcs[j].Line
	})
	for _, fn := range funcs {
		callees := make([]string, 0, len(fn.Calls))
		for callee := range fn.Calls {
			if callee != "" && callee != fn.Short {
				callees = append(callees, callee)
			}
		}
		sort.Strings(callees)
		for _, callee := range callees {
			set.Add(model.Fact{
				Identity:   model.Identity("call", fn.Short, callee),
				Layer:      model.LayerLogic,
				Kind:       "call",
				Title:      fn.Short + " → " + callee,
				File:       fn.File,
				Line:       fn.Calls[callee],
				Function:   fn.Short,
				Confidence: model.Extracted,
			})
		}
	}
	return set
}

func mergeLayer(dst, src model.FactSet, layer model.Layer) {
	for _, fact := range src[layer] {
		dst.Add(fact)
	}
}

func collectSSACalls(fn *ssa.Function, info *IRFunc) {
	for _, bid := range fn.Blocks {
		block, ok := fn.GetBasicBlockByID(bid)
		if !ok || block == nil {
			continue
		}
		for _, iid := range block.Insts {
			inst, ok := fn.GetInstructionById(iid)
			if !ok || inst == nil {
				continue
			}
			if lazy, ok := inst.(*ssa.LazyInstruction); ok {
				inst = lazy.Self()
			}
			call, ok := ssa.ToCall(inst)
			if !ok || call == nil {
				continue
			}
			name := ssCallName(call)
			if name == "" {
				continue
			}
			line := int32(ssaLine(inst))
			if line == 0 {
				continue
			}
			if _, exists := info.Calls[name]; !exists {
				info.Calls[name] = line
			}
		}
	}
}

func collectSSABranches(fn *ssa.Function, file string) []branchInfo {
	var out []branchInfo
	for _, bid := range fn.Blocks {
		block, ok := fn.GetBasicBlockByID(bid)
		if !ok || block == nil {
			continue
		}
		for _, iid := range block.Insts {
			inst, ok := fn.GetInstructionById(iid)
			if !ok || inst == nil {
				continue
			}
			if lazy, ok := inst.(*ssa.LazyInstruction); ok {
				inst = lazy.Self()
			}
			switch v := inst.(type) {
			case *ssa.If:
				line := int32(ssaLine(inst))
				cond, _ := fn.GetValueById(v.Cond)
				condText := ""
				if cond != nil {
					condText = compact(cond.GetSourceCode(), 120)
				}
				b := branchInfo{
					Func:       shortName(fn.GetName()),
					File:       file,
					Line:       line,
					Group:      line,
					Kind:       "if",
					Cond:       condText,
					GroupLabel: condText,
					Branch:     "true",
					ThenCalls:  blockCalls(fn, v.True, map[int64]struct{}{v.False: {}}),
					ElseCalls:  blockCalls(fn, v.False, map[int64]struct{}{v.True: {}}),
					ThenStart:  blockStartLine(fn, v.True),
					ThenEnd:    blockEndLine(fn, v.True),
					ElseStart:  blockStartLine(fn, v.False),
					ElseEnd:    blockEndLine(fn, v.False),
					Guard:      blockExits(fn, v.True) || blockExits(fn, v.False),
				}
				out = append(out, b)
			case *ssa.Switch:
				line := int32(ssaLine(inst))
				cond, _ := fn.GetValueById(v.Cond)
				condText := ""
				if cond != nil {
					condText = compact(cond.GetSourceCode(), 120)
				}
				stop := map[int64]struct{}{}
				if v.DefaultBlock != nil {
					stop[v.DefaultBlock.GetId()] = struct{}{}
				}
				for _, label := range v.Label {
					stop[label.Dest] = struct{}{}
				}
				labels := make([]string, 0, len(v.Label))
				for _, label := range v.Label {
					lv, _ := fn.GetValueById(label.Value)
					labelText := "case"
					if lv != nil {
						if src := compact(lv.GetSourceCode(), 80); src != "" {
							labelText = src
						}
					}
					labels = append(labels, labelText)
					out = append(out, branchInfo{
						Func:       shortName(fn.GetName()),
						File:       file,
						Line:       line,
						Group:      line,
						Kind:       "switch",
						Cond:       labelText,
						GroupLabel: "switch",
						Branch:     labelText,
						ThenCalls:  blockCalls(fn, label.Dest, withoutKey(stop, label.Dest)),
						ElseCalls:  map[string]struct{}{},
						ThenStart:  blockStartLine(fn, label.Dest),
						ThenEnd:    blockEndLine(fn, label.Dest),
					})
				}
				if v.DefaultBlock != nil {
					out = append(out, branchInfo{
						Func:       shortName(fn.GetName()),
						File:       file,
						Line:       line,
						Group:      line,
						Kind:       "switch",
						Cond:       condText,
						GroupLabel: "switch",
						Branch:     "default",
						ThenCalls:  blockCalls(fn, v.DefaultBlock.GetId(), withoutKey(stop, v.DefaultBlock.GetId())),
						ElseCalls:  map[string]struct{}{},
						ThenStart:  blockStartLine(fn, v.DefaultBlock.GetId()),
						ThenEnd:    blockEndLine(fn, v.DefaultBlock.GetId()),
					})
				}
				group := "switch"
				if condText != "" {
					group = "switch " + condText
				} else if len(labels) > 0 {
					group = "switch { " + strings.Join(labels, " | ") + " }"
				}
				for i := range out {
					if out[i].Func == shortName(fn.GetName()) && out[i].Line == line && out[i].Kind == "switch" {
						out[i].GroupLabel = group
					}
				}
			}
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Line != out[j].Line {
			return out[i].Line < out[j].Line
		}
		return out[i].Branch < out[j].Branch
	})
	return out
}

// blockCalls 收集从 start 可达的调用，遇到其他分支或汇合块就停。
// 这是一个有界的局部 CFG 查询，不做完整路径敏感分析。
func blockCalls(fn *ssa.Function, start int64, stops map[int64]struct{}) map[string]struct{} {
	out := map[string]struct{}{}
	if start <= 0 {
		return out
	}
	queue := []int64{start}
	visited := map[int64]struct{}{}
	for len(queue) > 0 && len(visited) < 48 {
		id := queue[0]
		queue = queue[1:]
		if _, ok := visited[id]; ok {
			continue
		}
		if _, stop := stops[id]; stop {
			continue
		}
		visited[id] = struct{}{}
		block, ok := fn.GetBasicBlockByID(id)
		if !ok || block == nil {
			continue
		}
		if id != start && len(block.Preds) > 1 {
			continue // 汇合块：不把后续路径算进这个分支
		}
		for _, iid := range block.Insts {
			inst, ok := fn.GetInstructionById(iid)
			if !ok || inst == nil {
				continue
			}
			if lazy, ok := inst.(*ssa.LazyInstruction); ok {
				inst = lazy.Self()
			}
			if call, ok := ssa.ToCall(inst); ok {
				if name := ssCallName(call); name != "" {
					out[name] = struct{}{}
				}
			}
		}
		queue = append(queue, block.Succs...)
	}
	return out
}

func withoutKey(in map[int64]struct{}, key int64) map[int64]struct{} {
	out := make(map[int64]struct{}, len(in))
	for k := range in {
		if k != key {
			out[k] = struct{}{}
		}
	}
	return out
}

func blockStartLine(fn *ssa.Function, id int64) int32 {
	block, ok := fn.GetBasicBlockByID(id)
	if !ok || block == nil {
		return 0
	}
	start := int32(0)
	for _, iid := range block.Insts {
		inst, ok := fn.GetInstructionById(iid)
		if !ok || inst == nil {
			continue
		}
		line := int32(ssaLine(inst))
		if line > 0 && (start == 0 || line < start) {
			start = line
		}
	}
	return start
}

func blockEndLine(fn *ssa.Function, id int64) int32 {
	block, ok := fn.GetBasicBlockByID(id)
	if !ok || block == nil {
		return 0
	}
	end := int32(0)
	for _, iid := range block.Insts {
		inst, ok := fn.GetInstructionById(iid)
		if !ok || inst == nil {
			continue
		}
		line := int32(ssaLine(inst))
		if line > end {
			end = line
		}
	}
	return end
}

func blockExits(fn *ssa.Function, id int64) bool {
	block, ok := fn.GetBasicBlockByID(id)
	if !ok || block == nil || len(block.Insts) == 0 {
		return false
	}
	inst, ok := fn.GetInstructionById(block.Insts[len(block.Insts)-1])
	if !ok || inst == nil {
		return false
	}
	if lazy, ok := inst.(*ssa.LazyInstruction); ok {
		inst = lazy.Self()
	}
	if _, ok := ssa.ToReturn(inst); ok {
		return true
	}
	return false
}

func ssCallName(call *ssa.Call) string {
	if call == nil || call.Method == 0 {
		return ""
	}
	method, ok := call.GetValueById(call.Method)
	if !ok || method == nil {
		return ""
	}
	name := shortName(method.GetName())
	if name == "" {
		return ""
	}
	switch name {
	case "string", "bool", "byte", "rune", "error", "int", "int8", "int16", "int32", "int64",
		"uint", "uint8", "uint16", "uint32", "uint64", "uintptr", "float32", "float64",
		"complex64", "complex128", "append", "len", "cap", "make", "new", "copy", "delete",
		"panic", "recover", "print", "println":
		return ""
	}
	return name
}

func functionPosition(root, programName string, fn *ssa.Function) (string, int32) {
	r := fn.GetRange()
	if r == nil {
		return "", 0
	}
	editor := r.GetEditor()
	if editor == nil {
		return "", 0
	}
	file := relFile(root, programName, editor.GetUrl())
	if file == "" {
		file = relFile(root, programName, editor.GetFilename())
	}
	line := int32(0)
	if r.GetStart() != nil {
		line = int32(r.GetStart().GetLine())
	}
	return file, line
}

func ssaLine(inst ssa.Instruction) int {
	if inst == nil {
		return 0
	}
	r := inst.GetRange()
	if r == nil || r.GetStart() == nil {
		return 0
	}
	return r.GetStart().GetLine()
}

func relFile(root, programName, name string) string {
	name = filepath.ToSlash(name)
	name = strings.TrimPrefix(name, "/"+programName+"/")
	name = strings.TrimPrefix(name, "/")
	if name == "" || name == " " {
		return ""
	}
	return name
}

// shortName 把 SSA 的内部名字收敛成逻辑层使用的短名。
func shortName(name string) string {
	name = strings.TrimPrefix(name, "*")
	if i := strings.LastIndex(name, "."); i >= 0 {
		name = name[i+1:]
	}
	if i := strings.LastIndex(name, "/"); i >= 0 {
		name = name[i+1:]
	}
	return name
}

func functionParams(fn *ssa.Function) []string {
	var out []string
	for _, id := range fn.Params {
		value, ok := fn.GetValueById(id)
		if !ok || value == nil {
			continue
		}
		out = append(out, value.GetType().String())
	}
	return out
}

func entryKindSSA(name string, params []string) string {
	joined := strings.ToLower(strings.Join(params, " "))
	if name == "main" {
		return "CLI 入口"
	}
	if strings.HasSuffix(name, "ServeHTTP") {
		return "HTTP 入口"
	}
	if strings.Contains(joined, "responsewriter") && strings.Contains(joined, "request") {
		return "HTTP 入口"
	}
	if strings.HasPrefix(name, "Test") && strings.Contains(joined, "testing.t") {
		return "测试入口"
	}
	return ""
}
