// Package scan 负责从一份代码库抽取三层事实。
//
// 分层策略：
//   - 项目结构层（L3）与逻辑结构层（L2）用 go/ast 直接解析。这些是语法层
//     就能确定的事实，不需要 SSA，用 SSA 反而慢且引入不稳定性。
//   - 意图层（L1）用 SSA + SyntaxFlow。这是唯一必须上 IR 才能拿到的东西：
//     数据从哪个入口流到哪个副作用。
package scan

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/yaklang/intentflow/internal/model"
)

// ProjectFacts 用 go/ast 抽取 L3 项目结构事实与 L2 逻辑结构事实。
//
// 返回的 FactSet 只包含 project 与 logic 两层，intent 层留空由 SSA 填。
func ProjectFacts(root string) (model.FactSet, error) {
	set := model.NewFactSet()

	fset := token.NewFileSet()
	var files []*ast.File
	var paths []string

	err := filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			name := d.Name()
			if name == "vendor" || name == "testdata" || strings.HasPrefix(name, ".") {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(p, ".go") || strings.HasSuffix(p, "_test.go") {
			return nil
		}
		f, perr := parser.ParseFile(fset, p, nil, parser.SkipObjectResolution)
		if perr != nil {
			// 单个文件解析失败不阻断整体，记为 notes 由调用方处理。
			return nil
		}
		files = append(files, f)
		paths = append(paths, p)
		return nil
	})
	if err != nil {
		return nil, err
	}

	for i, f := range files {
		rel := relPath(root, paths[i])

		// ---- L3: import ----
		for _, imp := range f.Imports {
			pkg, _ := strconv.Unquote(imp.Path.Value)
			if pkg == "" {
				continue
			}
			set.Add(model.Fact{
				Identity:   model.Identity("import", pkg),
				Layer:      model.LayerProject,
				Kind:       "import",
				Title:      "import " + pkg,
				File:       rel,
				Line:       fset.Position(imp.Pos()).Line,
				Confidence: model.Extracted,
			})
		}

		// ---- L3 + L2: 函数定义与调用边 ----
		for _, decl := range f.Decls {
			fn, ok := decl.(*ast.FuncDecl)
			if !ok {
				continue
			}
			recv := receiverName(fn)
			name := fn.Name.Name
			if recv != "" {
				name = recv + "." + name
			}
			set.Add(model.Fact{
				Identity:   model.Identity("func", name),
				Layer:      model.LayerProject,
				Kind:       "func",
				Title:      "func " + name,
				File:       rel,
				Line:       fset.Position(fn.Pos()).Line,
				Function:   name,
				Confidence: model.Extracted,
			})

			if fn.Body == nil {
				continue
			}
			for _, call := range callsIn(fn.Body) {
				// 只记录跨函数调用边，自调用不产生结构信息。
				if call.name == name {
					continue
				}
				set.Add(model.Fact{
					Identity: model.Identity("call", name, call.name),
					Layer:    model.LayerLogic,
					Kind:     "call",
					Title:    name + " → " + call.name,
					File:     rel,
					// 行号指向第一处调用点，而不是函数声明。
					// 图上的「查看代码」要能直接落到调用那一行。
					Line:       fset.Position(call.pos).Line,
					Function:   name,
					Confidence: model.Extracted,
				})
			}
		}
	}

	return set, nil
}

// callSite 是一处跨函数调用的名字与位置。
type callSite struct {
	name string
	pos  token.Pos
}

// callsIn 收集函数体内的被调方，去重后按名字排序。
// 同名调用保留第一处，身份键仍然只用函数名，位置仅用于跳转。
//
// 名字用「最后一段选择器」表示，例如 svc.FindUser 记为 FindUser，
// 避免 import 别名造成同一调用在不同文件里身份不稳定。
func callsIn(body *ast.BlockStmt) []callSite {
	seen := map[string]token.Pos{}
	ast.Inspect(body, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return true
		}
		name := calleeName(call.Fun)
		if name == "" {
			return true
		}
		if _, dup := seen[name]; !dup {
			seen[name] = call.Pos()
		}
		return true
	})
	out := make([]callSite, 0, len(seen))
	for name, pos := range seen {
		out = append(out, callSite{name: name, pos: pos})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].name < out[j].name })
	return out
}

// builtinConversions 是 Go 的内建类型转换。它们在 AST 里长得像调用，
// 但不是函数调用，放进逻辑结构层只会变成噪声。
var builtinConversions = map[string]struct{}{
	"string": {}, "bool": {}, "byte": {}, "rune": {}, "error": {},
	"int": {}, "int8": {}, "int16": {}, "int32": {}, "int64": {},
	"uint": {}, "uint8": {}, "uint16": {}, "uint32": {}, "uint64": {},
	"uintptr": {}, "float32": {}, "float64": {}, "complex64": {}, "complex128": {},
}

// calleeName 从调用表达式里取出被调方名字。
func calleeName(e ast.Expr) string {
	switch v := e.(type) {
	case *ast.Ident:
		if _, isBuiltin := builtinConversions[v.Name]; isBuiltin {
			return ""
		}
		return v.Name
	case *ast.SelectorExpr:
		return v.Sel.Name
	case *ast.IndexExpr:
		return calleeName(v.X)
	case *ast.IndexListExpr:
		return calleeName(v.X)
	case *ast.ParenExpr:
		return calleeName(v.X)
	case *ast.FuncLit:
		return "<closure>"
	}
	return ""
}

// receiverName 返回方法接收者类型名，普通函数返回空串。
func receiverName(fn *ast.FuncDecl) string {
	if fn.Recv == nil || len(fn.Recv.List) == 0 {
		return ""
	}
	t := fn.Recv.List[0].Type
	for {
		switch v := t.(type) {
		case *ast.StarExpr:
			t = v.X
			continue
		case *ast.Ident:
			return v.Name
		case *ast.IndexExpr:
			t = v.X
			continue
		}
		break
	}
	return ""
}

// relPath 把绝对路径转成相对 root 的斜杠路径。
func relPath(root, p string) string {
	r, err := filepath.Rel(root, p)
	if err != nil {
		return p
	}
	return filepath.ToSlash(r)
}

// EnsureRoot 校验目录存在，返回绝对路径。
func EnsureRoot(p string) (string, error) {
	abs, err := filepath.Abs(p)
	if err != nil {
		return "", err
	}
	st, err := os.Stat(abs)
	if err != nil {
		return "", fmt.Errorf("目标目录不可读: %w", err)
	}
	if !st.IsDir() {
		return "", fmt.Errorf("目标不是目录: %s", abs)
	}
	return abs, nil
}
