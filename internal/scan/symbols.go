package scan

import (
	"path"
	"sort"
	"strings"

	"github.com/yaklang/yaklang/common/yak/ssa"
	"github.com/yaklang/yaklang/common/yak/ssaapi"

	"github.com/yaklang/intentflow/internal/contract"
	"github.com/yaklang/intentflow/internal/model"
)

// BuildSymbolGraph 把两侧 IR 索引合并成一张函数/类型关系图。
//
// 这是「行为图之外的全量结构图」：行为图只覆盖变更链上的四类角色，
// 这里覆盖 SSA 能确定解析的全部函数、类型与调用边。
// 解析不到的调用写入 unresolved，绝不按名字猜一条边出来。
func BuildSymbolGraph(before, after *IRIndex) model.SymbolGraph {
	entries := map[string]*symbolEntry{}
	funcIDs := map[string]map[string][]string{} // short -> side -> ids

	merge := func(idx *IRIndex, side string) {
		if idx == nil {
			return
		}
		for _, fn := range idx.Funcs {
			if fn.File == "" || fn.Line == 0 {
				continue
			}
			id := "fn:" + fn.File + "#" + fn.Short
			entry := entries[id]
			if entry == nil {
				entry = &symbolEntry{
					kind:  "function",
					name:  fn.Short,
					pkg:   packageOf(fn.File),
					sides: map[string]symbolSide{},
				}
				entries[id] = entry
			}
			entry.sides[side] = symbolSide{
				file: fn.File,
				line: fn.Line,
				sig:  "func " + fn.Short + "(" + strings.Join(fn.Params, ", ") + ")",
				hash: fn.Hash,
			}
			if funcIDs[fn.Short] == nil {
				funcIDs[fn.Short] = map[string][]string{}
			}
			funcIDs[fn.Short][side] = append(funcIDs[fn.Short][side], id)
		}
		for _, typ := range idx.Types {
			if typ.File == "" || typ.Line == 0 {
				continue
			}
			id := "type:" + typ.File + "#" + typ.Name
			entry := entries[id]
			if entry == nil {
				entry = &symbolEntry{
					kind:  "type",
					name:  typ.Name,
					pkg:   packageOf(typ.File),
					sides: map[string]symbolSide{},
				}
				entries[id] = entry
			}
			entry.sides[side] = symbolSide{
				file: typ.File,
				line: typ.Line,
				sig:  "type " + typ.Name + " " + typ.Kind,
			}
			entry.members = typ.Members
		}
	}
	merge(before, "before")
	merge(after, "after")

	// 短名可能在同一文件或不同包重名。只接受唯一解，避免把调用连到错误的函数。
	resolve := func(short, fromFile string) (string, bool) {
		ids := funcIDs[short]["after"]
		if len(ids) == 0 {
			ids = funcIDs[short]["before"]
		}
		if len(ids) == 1 {
			return ids[0], true
		}
		found := []string{}
		for _, id := range ids {
			if entry := entries[id]; entry != nil && entry.sides["after"].file == fromFile {
				found = append(found, id)
			}
		}
		if len(found) == 1 {
			return found[0], true
		}
		return "", false
	}

	edges := map[string]*edgeEntry{}
	unresolved := map[string]model.SymbolRef{}
	scanCalls := func(idx *IRIndex, side string) {
		if idx == nil {
			return
		}
		for _, fn := range idx.Funcs {
			if fn.File == "" || fn.Line == 0 {
				continue
			}
			from := "fn:" + fn.File + "#" + fn.Short
			for callee, line := range fn.Calls {
				to, ok := resolve(callee, fn.File)
				if !ok || to == "" {
					key := from + "|" + callee
					unresolved[key] = model.SymbolRef{Name: callee, From: from, File: fn.File, Line: line}
					continue
				}
				key := from + "->" + to
				edge := edges[key]
				if edge == nil {
					edge = &edgeEntry{from: from, to: to, sides: map[string]int32{}}
					edges[key] = edge
				}
				edge.sides[side] = line
			}
		}
	}
	scanCalls(before, "before")
	scanCalls(after, "after")

	nodes := make([]model.SymbolNode, 0, len(entries))
	for id, entry := range entries {
		delta := contract.DeltaKindUnchanged
		line := entry.sides["after"].line
		switch {
		case entry.sides["after"].file != "" && entry.sides["before"].file != "":
			if entry.sides["after"].sig != entry.sides["before"].sig || entry.sides["after"].hash != entry.sides["before"].hash {
				delta = contract.DeltaKindModified
			}
		case entry.sides["after"].file != "":
			delta = contract.DeltaKindAdded
		case entry.sides["before"].file != "":
			delta = contract.DeltaKindRemoved
			line = entry.sides["before"].line
		}
		file := entry.sides["after"].file
		if file == "" {
			file = entry.sides["before"].file
		}
		members := entry.members
		if members == nil {
			members = []string{}
		}
		nodes = append(nodes, model.SymbolNode{
			Id:        id,
			Kind:      contract.SymbolKind(entry.kind),
			Name:      entry.name,
			Package:   entry.pkg,
			File:      file,
			Line:      line,
			Delta:     delta,
			Signature: entry.sides["after"].sig,
			Members:   members,
			Exported:  isExported(entry.name),
		})
		if nodes[len(nodes)-1].Signature == "" {
			nodes[len(nodes)-1].Signature = entry.sides["before"].sig
		}
	}
	sort.Slice(nodes, func(i, j int) bool {
		if nodes[i].File != nodes[j].File {
			return nodes[i].File < nodes[j].File
		}
		if nodes[i].Line != nodes[j].Line {
			return nodes[i].Line < nodes[j].Line
		}
		return nodes[i].Id < nodes[j].Id
	})

	edgeList := make([]model.SymbolEdge, 0, len(edges))
	for key, entry := range edges {
		delta := contract.DeltaKindUnchanged
		_, inAfter := entry.sides["after"]
		_, inBefore := entry.sides["before"]
		switch {
		case inAfter && !inBefore:
			delta = contract.DeltaKindAdded
		case inBefore && !inAfter:
			delta = contract.DeltaKindRemoved
		}
		line, ok := entry.sides["after"]
		if !ok || line == 0 {
			line = entry.sides["before"]
		}
		edgeList = append(edgeList, model.SymbolEdge{
			Id:       "call:" + key,
			From:     entry.from,
			To:       entry.to,
			Kind:     contract.SymbolEdgeKindCall,
			Delta:    delta,
			Line:     line,
			Resolved: true,
		})
	}
	sort.Slice(edgeList, func(i, j int) bool { return edgeList[i].Id < edgeList[j].Id })

	byID := map[string]*model.SymbolNode{}
	for i := range nodes {
		byID[nodes[i].Id] = &nodes[i]
	}
	for _, edge := range edgeList {
		if node := byID[edge.From]; node != nil {
			node.Callees++
		}
		if node := byID[edge.To]; node != nil {
			node.Callers++
		}
	}

	unresolvedList := make([]model.SymbolRef, 0, len(unresolved))
	for _, ref := range unresolved {
		unresolvedList = append(unresolvedList, ref)
	}
	sort.Slice(unresolvedList, func(i, j int) bool {
		if unresolvedList[i].From != unresolvedList[j].From {
			return unresolvedList[i].From < unresolvedList[j].From
		}
		if unresolvedList[i].Line != unresolvedList[j].Line {
			return unresolvedList[i].Line < unresolvedList[j].Line
		}
		return unresolvedList[i].Name < unresolvedList[j].Name
	})

	functions, types := int32(0), int32(0)
	for _, node := range nodes {
		if node.Kind == contract.Function {
			functions++
		} else {
			types++
		}
	}
	return model.SymbolGraph{
		Nodes:      nodes,
		Edges:      edgeList,
		Unresolved: unresolvedList,
		Stats: model.SymbolStats{
			Functions:  functions,
			Types:      types,
			Calls:      int32(len(edgeList)),
			Unresolved: int32(len(unresolvedList)),
		},
	}
}

type symbolSide struct {
	file string
	line int32
	sig  string
	hash string
}

type symbolEntry struct {
	kind    string
	name    string
	pkg     string
	members []string
	sides   map[string]symbolSide
}

type edgeEntry struct {
	from  string
	to    string
	sides map[string]int32
}

func packageOf(file string) string {
	dir := path.Dir(file)
	if dir == "." || dir == "/" {
		return path.Base(file)
	}
	return dir
}

func isExported(name string) bool {
	if name == "" {
		return false
	}
	return name[0] >= 'A' && name[0] <= 'Z'
}

// collectTypes 从 SSA 指令值上的类型对象收集类型声明。
//
// yaklang 的 Go 前端不把本地类型写进 Program.Blueprint（实测只有
// __GlobalVariables__），但每个类型对象都带着声明位置。这里按
// (文件, 名称) 去重，跳过匿名组合类型与标准库类型。
func collectTypes(prog *ssaapi.Program, root, programName string, index *IRIndex) {
	if prog == nil || prog.Program == nil {
		return
	}
	prog.Program.EachFunction(func(fn *ssa.Function) {
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
				value, ok := ssa.ToValue(inst)
				if !ok || value == nil {
					continue
				}
				typ := value.GetType()
				if typ == nil {
					continue
				}
				kind := typ.GetTypeKind()
				if kind != ssa.StructTypeKind && kind != ssa.ObjectTypeKind && kind != ssa.InterfaceTypeKind {
					continue
				}
				name := typeName(typ)
				if name == "" {
					continue
				}
				r := inst.GetRange()
				if r == nil {
					continue
				}
				line := int32(0)
				if start := r.GetStart(); start != nil {
					line = int32(start.GetLine())
				}
				if line == 0 {
					continue
				}
				file := ""
				if editor := r.GetEditor(); editor != nil {
					file = relFile(root, programName, editor.GetUrl())
					if file == "" {
						file = relFile(root, programName, editor.GetFilename())
					}
				}
				if file == "" || !strings.HasSuffix(file, ".go") {
					continue
				}
				key := "type:" + file + "#" + name
				if existing, exists := index.Types[key]; exists {
					if existing.Line <= line {
						continue
					}
				}
				members := []string{}
				if object, ok := typ.(*ssa.ObjectType); ok {
					for _, member := range object.Keys {
						if member != nil {
							members = append(members, member.GetName())
						}
					}
				}
				sort.Strings(members)
				if len(members) > 40 {
					members = members[:40]
				}
				methods := make([]string, 0)
				for method := range typ.GetMethod() {
					methods = append(methods, method)
				}
				sort.Strings(methods)
				index.Types[key] = &IRType{
					Key:     key,
					Name:    name,
					Kind:    typeKindName(kind),
					File:    file,
					Line:    line,
					Members: members,
					Methods: methods,
				}
			}
		}
	})
}

// typeName 只接受可读的具名类型，匿名结构体一律跳过。
func typeName(typ ssa.Type) string {
	raw := strings.TrimSpace(typ.String())
	if cleanTypeName(raw) {
		return raw
	}
	for _, full := range typ.GetFullTypeNames() {
		candidate := strings.TrimSpace(full)
		if i := strings.LastIndexAny(candidate, "/."); i >= 0 {
			candidate = candidate[i+1:]
		}
		if cleanTypeName(candidate) {
			return candidate
		}
	}
	return ""
}

func cleanTypeName(name string) bool {
	if name == "" || len(name) > 80 {
		return false
	}
	if strings.ContainsAny(name, "{} /<>[]*()") {
		return false
	}
	switch name {
	case "any", "undefined", "error", "object", "struct", "interface", "type":
		return false
	}
	return true
}

func typeKindName(kind ssa.TypeKind) string {
	switch kind {
	case ssa.InterfaceTypeKind:
		return "interface"
	case ssa.ObjectTypeKind:
		return "class"
	default:
		return "struct"
	}
}
