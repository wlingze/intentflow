package scan

// Sink 描述一个「副作用点」：值得被追源的调用。
//
// Query 是 SyntaxFlow 规则，约定用 $param 绑定该调用的参数。
// 规则必须只匹配「调用」，不要只写 *.Query，那样会匹配到方法值而不是调用。
type Sink struct {
	// Category 是副作用类别，用于聚合与去重。
	Category string
	// Label 是给人看的名字。
	Label string
	// Query 是 SyntaxFlow 规则。
	Query string
	// Exclude 是命中后仍要丢弃的子串。SyntaxFlow 按方法名匹配，
	// 会把同名但语义完全不同的方法一起抓进来，必须显式排除。
	Exclude []string
}

// GoSinks 是 Go 项目的副作用点清单。
//
// 第一版只覆盖三类最常见的副作用。扩展方式：加一行。
// 每条 Query 都约束了参数变量 $param，否则链路抽取退化成「只看到调用名」。
//
// 两个已验证的 SyntaxFlow 行为，决定了下面的写法：
//
//  1. `*.Method(...)` 不会匹配标准库成员。`os.ReadFile(x)` 用 `*.ReadFile(*)`
//     一条也匹配不到，必须写成 `os.ReadFile(*)`。所以标准库调用要显式写包名。
//  2. `*.Method(...)` 会匹配所有同名方法。`*.Query(*)` 会把
//     `r.URL.Query()` 也抓进来，所以必须配 Exclude。
//
// 已知取舍：不收录 `*.Get` / `*.Do` 这类万能方法名。它们在任何项目上
// 都会产出大量误报（URL.Query().Get、map.Get、cache.Get …），
// 而误报会直接毁掉 review 的可用性。
var GoSinks = []Sink{
	{
		Category: "sql",
		Label:    "SQL 执行",
		Query: `*.Query(* as $param) as $sink;
*.QueryRow(* as $param) as $sink;
*.Exec(* as $param) as $sink;
*.Raw(* as $param) as $sink;`,
		Exclude: []string{"URL.Query", "QueryTable", "Header.Get"},
	},
	{
		Category: "exec",
		Label:    "进程执行",
		Query: `*.Command(* as $param) as $sink;
*.CommandContext(* as $param) as $sink;
exec.Command(* as $param) as $sink;
exec.CommandContext(* as $param) as $sink;`,
	},
	{
		Category: "file",
		Label:    "文件读写",
		Query: `os.ReadFile(* as $param) as $sink;
os.WriteFile(* as $param) as $sink;
os.OpenFile(* as $param) as $sink;
os.Open(* as $param) as $sink;
ioutil.ReadFile(* as $param) as $sink;
ioutil.WriteFile(* as $param) as $sink;`,
	},
}
