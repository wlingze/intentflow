# 技术发现

实测环境：yaklang `v1.4.9-beta4`，通过 go.mod 引入，Go 1.27.3。

## 已验证可行

| 能力 | 结论 |
|---|---|
| yaklang 作为 Go 库引入 | 可行。`go get github.com/yaklang/yaklang@v1.4.9-beta4` + 编译通过。产物 277 MB。 |
| 内存模式编译 Go 目录 | 可行。`WithCompileMemoryCompile(true)` + `WithSyntaxFlowMemory(true)` |
| SyntaxFlow 查询 | 可行。`prog.SyntaxFlowWithError(rule)` |
| 跨函数数据流回溯 | 可行。`Value.GetTopDefs()` 能穿出函数边界到调用方 |
| 函数归属 | 可行。`Value.GetFunction().GetName()` |
| 精确定位 | 可行。`Value.GetRange().GetStart().GetLine()` |
| 结果提取 | `result.GetValues("变量名")`，**变量名不带 `$`** |

## SyntaxFlow 的实测行为（会咬人）

### 1. `*.Method(...)` 不匹配标准库成员

```
os.ReadFile(x)          →  os.ReadFile(* as $p)   ✅ 命中
                           *.ReadFile(* as $p)     ❌ 零结果
db.Query(q)             →  *.Query(* as $p)       ✅ 命中
```

`os` / `fmt` / `exec` 是 ExternLib，`*.` 通配符不进去。**标准库调用必须显式写包名。**

推论：sink 规则要同时写两种形式（`*.Query` 和 `os.ReadFile`），并接受 import 别名会漏。

### 2. `*.Method(...)` 会匹配所有同名方法

`*.Query(* as $p)` 把 `r.URL.Query()` 也抓进来了，被误判成「SQL 执行」。必须配 `Exclude` 子串黑名单。

推论：**Go 这种「方法名到处复用」的语系，纯按名字匹配的规则误报率很高。** 这是 v0 最大的精度短板。

### 3. `*?{opcode:call}` 条件无效

试过 `opcode:call` 和 `opcode:Call`，都返回 0。没继续挖 —— 改成了「按 sink 规则反查」，不枚举全部调用。

### 4. `GetTopDefs()` 返回叶子，不返回路径

对 `fmt.Sprintf("... '%s'", name)` 调 `GetTopDefs()`：

```
ExternLib-fmt                              ← 叶子
"SELECT id FROM users WHERE name LIKE..."  ← 叶子
Parameter-r            @28:42  in handleSearch   ← 叶子
http.Request.URL.Query  @29:10  in handleSearch  ← 叶子
"name"                  @29:28                    ← 叶子
```

拿到的是**遍历终点集合**，不是有序路径。中间节点（比如 `Get`、`URL.Query()` 的返回值）不保留。

影响：
- 跨函数归属可用（叶子上 `GetFunction()` 是对的）
- 但重建「A → B → C」的有序链需要自己 BFS
- **候选集必须含实参本身**，否则 `os.Getenv("X") + "/a"` 这类会判成没有来源

### 5. 结果变量名不带 `$`

`GetValues("param")` 对，`GetValues("$param")` 静默返回空。踩过一次。

## Go 前端的缺口

编译 demo 时产生 10 条诊断：

```
ExternLib [http] don't has [HandleFunc]
ExternLib [http] don't has [Error]
ExternLib [os]   don't has [Getenv]
ExternLib [os]   don't has [ReadFile]
ExternLib [fmt]  don't has [Sprintf]
```

**yaklang 的 Go 前端没有内置标准库签名。** 所有标准库调用都被编译成 `Undefined-<pkg>.<Func>`。

实际影响：

| 能力 | 受影响 |
|---|---|
| 调用边 | 不受影响，调用指令仍然生成 |
| 实参可见 | 不受影响，参数嵌在调用值里 |
| 参数回溯 | 不受影响，`GetTopDefs` 仍能穿过 |
| 返回值类型 | **受影响**，全是 undefined |
| 类型级污点传播 | **受影响**，`fmt.Sprintf` 的返回值类型未知 |
| 误报/漏报控制 | **受影响**，无法按类型排除同名方法 |

结论：**能做出可用的意图链，但精度上限受限于缺失的标准库签名。**

修复方向（未验证）：给 Go 补一份标准库 extern lib 定义。这是 yaklang 侧的活，不是本项目的。

## 性能

demo（单文件 43 行）：双边编译 + 3 类 sink 规则，约 1–2 秒。

已在 yaklang ssa2llvm 的 304 个文件上跑通；整仓 11k 文件未测。`TODO_SCAN_OPTIMIZATION.md` 记录了 yaklang 侧已知的大项目性能问题（moodle 11134 个 source）。

## 未验证

- 大项目（>100 文件）的编译时间与内存（yaklang ssa2llvm 304 文件已跑通，约 1 分钟）
- 跨文件数据流（demo 只有单文件）
- 泛型、接口、闭包场景下的链完整性
- 行号在 `before`/`after` 间的稳定性（当前 identity 不含行号，但 UI 展示用它）
