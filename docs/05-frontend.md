# 工作台交互：两种视角，一个 review

> 本文描述 `frontend/` 的交互与布局。行为图的语义见 [07-behavior-model.md](07-behavior-model.md)，数据契约见 [08-contract.md](08-contract.md)。

## 1. 问题

旧版把代码放在右侧抽屉里。抽屉一开，图被遮住一半，Review 栏完全消失；代码虽然大，但 review 的上下文断了。

review 需要同时看两样东西：

- **图**：这次改动在行为上做了什么。
- **代码**：具体哪一行、哪个条件、哪个 shape。

两者不能互相遮挡。所以改成**两个主视角**，每个视角都有一个次要视图：

| 视角 | 主区域 | 次要区域 | 适合 |
| --- | --- | --- | --- |
| 行为图 | 全宽 DAG | 右下角浮动代码预览 | 先理解改动，再下钻 |
| 代码 | 全宽 diff / 搜索 | 左下角行为缩略图 | 逐行 review，随时回图 |

顶栏的「行为图 / 代码」开关切换。右侧 Review 栏在两个视角都保留。

## 2. 行为图视角

```text
┌──────────────────────────────────────────────────────────────┐
│ top bar: brand · path · stats · 行为图/代码 · theme · 提交    │
├────────────┬──────────────────────────────────┬──────────────┤
│ 文件树     │ 行为图（阶段列 + 角色颜色）      │ SyntaxFlow   │
│ 项目结构   │                                  │ / Review     │
│            │  点击节点 → 右下角代码预览       │              │
│            │                                  │              │
│            ├──────────────────────────────────┤              │
│            │ 行为清单 + 三层事实 ledger       │              │
├────────────┴──────────────────────────────────┴──────────────┤
│ composer: 引用 chip + 输入框 + 添加评论                      │
└──────────────────────────────────────────────────────────────┘
```

### 2.1 图

- 列 = 因果阶段，由后端 `stage` 给出。
- 颜色 = 行为角色：触发蓝、判定琥珀、变换中性、效果绿。
- 边框 = delta：新增绿、移除红虚线、变化琥珀。
- 边 = `call` / `data` / `control`；数据边标 shape，控制边标分支。
- 效果节点统一贴在最右列，方便比较 before/after。
- 图的下方是**行为清单**（scenario 卡片）和**三层事实 ledger**。图不再孤零零地悬在空白里，review 证据就在同一屏。

为什么不做固定四列：判定可以出现在变换之后。固定四列会把后面的判定画到前面，产生回边。详见 [07-behavior-model.md §6](07-behavior-model.md#6-阶段排版)。

### 2.2 代码预览（peek）

点击节点或边，右下角出现浮动卡片：

- 角色、delta、shape 变化（如 `direct → format`）。
- `file:line` 与前后 4 行代码。
- 「引用到评论」把这段代码放进 composer。
- 「打开代码」切到代码视角，并定位到该行。

预览不覆盖 Review 栏，也不占满图。关闭后回到图。

## 3. 代码视角

```text
┌──────────────────────────────────────────────────────────────┐
│ top bar                                                      │
├────────────┬──────────────────────────────────┬──────────────┤
│ 文件树     │ 文件 tab · Diff/搜索 · 分栏/统一 │ Review 栏    │
│            │                                  │              │
│            │ 大区域 diff                       │              │
│            │ ┌──────────────┐                 │              │
│            │ │ 行为缩略图   │                 │              │
│            │ └──────────────┘                 │              │
├────────────┴──────────────────────────────────┴──────────────┤
│ composer                                                     │
└──────────────────────────────────────────────────────────────┘
```

- 代码区占满中栏，不再是右侧 820px 抽屉。
- 默认统一 diff；分栏仍可切换（宽屏可用）。
- 选中代码 → 浮动「添加评论」→ 引用进入 composer。
- 左下角缩略图：整个行为图按比例缩小，支持放大/缩小/适应窗口/拖拽，点击节点跳到对应代码行。
- 缩略图可收起；收起后工具栏出现「显示缩略图」。

### 3.1 缩略图为什么在左下角

代码阅读从左到右、从上到下。左下角是视线的「回头位」，不挡代码首行，也不挡右侧评论。用户要求「代码大，同时还能看图」，缩略图是图的常驻入口，而不是第二个全尺寸面板。

## 4. 状态

```ts
interface AppState {
  view: 'graph' | 'code';
  rightTab: 'signals' | 'review';
  selected: { kind: 'node' | 'edge'; id: string } | null;
  peek: { open: boolean; nodeId?; edgeId?; file?; line?; side? };
  code: { files; active; mode; layout; line?; side?; search };
  composer: { quote; text; focusToken };
  comments; dismissed; kept;
  onlyChanged;
}
```

- 评论/忽略/保留写 `localStorage`，key 是 `intentflow.review:<before>-><after>`。
- 切换视角不丢评论；`selected` 保留，缩略图高亮。
- 缩略图缩放/平移是组件内部状态，不持久化。

## 5. 视觉

- 深色是默认；浅色是一套暖纸色 token，不是简单反色。
- 颜色只做语义：绿=新增/安全，红=移除/风险，琥珀=变化/判定。
- 代码字体 `var(--mono)`，界面字体 `var(--sans)`；不使用第三种装饰字体。
- 图例、阶段标签、ledger 都是 9–10px 的等宽字，形成「工程仪表」的密度。
- 动效只有抽屉/预览的 0.12–0.16s 淡入；尊重 `prefers-reduced-motion`（图上的 pulse 已移除）。

## 6. 数据流

```text
Go: scan/diff → Review + BehaviorGraph
              → payload.Build (CodeBundle)
              → GET /api/payload
                      │
React: fetch → layoutBehavior → SVG + ledger
              │
              ├─ click node → peek → code/open
              ├─ select code → quote → composer → comment
              └─ submit → POST /api/review → review.md
```

前端不重新计算行为图，不重新 diff 事实；只做布局、缩放、选择和评论。

## 7. 验证

- `pnpm typecheck` 通过。
- 浏览器验证：分叉图、`switch` 判定、节点 peek、`main.go:21` 跳转、缩略图点击跳转、选中引用、评论、提交、搜索、深色/浅色。
- `review.md` 与 `review-state.json` 写入 `examples/demo-go/out/`。
