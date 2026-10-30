# Review-first workbench acceptance contract

## Goal

Turn intentflow into a review-first workbench. Large code diffs and reliable review actions take priority over the graph. SSA and SyntaxFlow remain the only sources of semantic facts.

## Baseline

- Baseline commit: `9d8f8b1`.
- Production preview: `http://127.0.0.1:8124`.
- `frontend/src/lib/diff.ts` uses a quadratic LCS matrix and a position-based fallback above 4,000,000 cells. The fallback can mark the rest of a file changed after one inserted line.
- `DiffView.tsx` maps every row to DOM and highlights every rendered line.
- `App.module.css` hides both navigation and review panels below 940px without a replacement control.
- `App.tsx` unmounts the other view during graph/code switching.
- The server currently serves one immutable folder comparison. There is no commit endpoint or Git comparison metadata.
- Screenshots and the baseline browser snapshot are in `/tmp/intentflow-review-upgrade/`.

## Acceptance checks

1. Code is the default view. File navigation is above behavior navigation. Each navigation section can collapse independently.
2. Split and unified views show correct old/new line numbers. A sparse insertion in a 20,000-line fixture does not mark all later lines changed.
3. Large diff rendering is bounded by the viewport. Scrolling, file switching, line navigation, and quoting work on virtualized rows.
4. Word wrap is a user setting. Both sides remain reachable in a narrow split view. Hidden sidebars have visible open controls.
5. AI risks and SyntaxFlow findings are separate items. Each supports ignore, restore, add-to-review, and navigation to real evidence. Repeated add-to-review does not duplicate a finding. Comment editing, deletion, reload, and review export retain their meaning.
6. Branch labels name the actual comparison. Commit selection changes the displayed source comparison using actual Git data. Non-selected intervening commits must not silently enter the selected comparison. Folder-only input must say that commit metadata is unavailable.
7. The symbol graph includes SSA functions and type definitions, not only functions on source-to-sink paths. Every parsed call remains represented, including parallel calls, recursion, and cycles. Unresolved references are explicit rather than fabricated.
8. File groups enclose their own nodes. Within each group, call edges determine the layout, not source order. Compound layout must work with new JSON inputs.
9. Selecting a function or type opens a lower graph. Shared behavior nodes are merged by identity. Selecting an inner node opens its source evidence.
10. Added items are green. Removed items are red with dashed borders or edges. Modified items are yellow. Theme changes retain readable labels and clear arrowheads.
11. Geometry checks reject overlapping nodes and edges through unrelated nodes. The router minimizes edge crossings and reports remaining crossings. Arbitrary non-planar graphs cannot satisfy an unconditional zero-crossing guarantee while showing every edge.
12. Unit tests, Go tests, typecheck, build, actual desktop and narrow browser interactions must pass. An independent review checks the final diff and this decision trail.

## Verification policy

Use a committed deterministic fixture and browser check rather than screenshots alone. Capture timing only after confirming correct displayed output and zero errors. This host has high concurrent load, so timing alone cannot prove a speedup. Report production-build median and range from at least five samples if claiming a timing improvement. Prefer bounded DOM and correct line mapping as stable gates.

## Throughput checkpoint

- Blocking first steps: inspect state, Git inputs, SSA type/call data, and build regression fixtures before implementation.
- Independent workstreams: code rendering, backend comparison/semantic contract, and graph layout can be isolated after shared types are settled.
- Shared mutable state: OpenAPI and generated files have one owner. App state and review integration have one owner. Other workers use isolated worktrees and report commits for manual integration.
- Smallest safe decomposition: one backend owner, one diff renderer owner, and one graph owner. The parent owns review integration, verification tooling, browser acceptance, and documentation.

## Visual direction

Use the existing Archify-inspired canvas, typography, and theme tokens rather than a new brand. The review workspace uses neutral surfaces and compact toolbars. Delta colors carry meaning. File groups are large low-contrast boundary frames, not columns of sequential cards. A narrow screen trades sidebar width for a user-opened drawer, never for disappearing features.

## Implementation status (2026-10-30)

### Verified

- `frontend/src/lib/diff.ts`: prefix/suffix trim + patience anchors + bounded Myers. 20,000 lines with one insertion reports 1 add / 0 dels; 50 scattered edits report exactly 50/50. 15 unit tests pass.
- `DiffView` renders only the viewport window (fixed 20 px rows, measured rows when wrap is on). Quote selection, `[data-line]` attributes, target scrolling and highlighting are preserved.
- Split and unified layouts both show old/new line numbers. Split is always two equal flexible columns; long lines scroll inside their own cell so the other side never leaves the viewport.
- Word wrap is a user toggle in the code toolbar, persisted in `localStorage` (`intentflow.prefs`).
- Below 940 px the left and right panels become opaque drawers with a backdrop, opened from the top bar. Nothing disappears without a control.
- Code is the default view. The left column stacks 文件 / 符号图 / 行为导航, each collapsible; symbols carry functions and SSA types grouped by file.
- AI risks and SyntaxFlow signals are separate itemized cards. Each has 定位 / 忽略（可撤销）/ 加入 Review. Repeated add is disabled; ids are stable (`ai:<index>:<title slug>`).
- Git mode: `--repo --subdir --from --to`. `/api/commits` lists commits; `/api/payload?commits=…` rebuilds from the selected commits only. Verified on `feature-ssa2llvm-support_ci_and_mustpass_test`: 6 commits → 10 files; selecting 2 → 5 files and 53 facts, and the labels change to `5bf91600 → 2b73d555 · 2/6 提交`.
- Symbol graph from SSA only: 1977 functions, 360 types, 1472 resolved call edges on the ssa2llvm subtree. Type positions come from SSA type objects (declaration lines verified against source). Unresolved calls are listed, never fabricated.
- Drill-down: clicking a function opens a 1-hop graph with shared nodes merged; file groups stay visible; 定位 opens the exact source line.
- Delta colors: added green, removed red with dashed borders, modified yellow.

### Known limitations (not hidden)

- Arbitrary non-planar call graphs cannot guarantee zero edge crossings while showing every edge. The view shows live crossing and card-occlusion counts (`交叉 N · 穿卡 M`). Drill-down scopes use an A* grid router; the full graph uses curves because routing 1,400+ edges interactively is too slow.
- Default scope is 仅改动. 改动+邻居 and 全部 are explicit choices; edges outside the chosen scope are counted (`范围内边 k/N`), not silently dropped.
- Rebuilding a commit selection re-runs the full SSA analysis (minutes on large subtrees). Results are cached per selection in memory.
- Commit selection applies whole-file versions from the selected commits. A non-selected commit that edited the same file does not appear as its own change; this is stated in `Comparison.note`.
- Dir-only comparisons report `mode: folder` and the picker explains that commit metadata is unavailable.
- AI risk actions were verified with a fixture payload because the LLM gateway returned 401 during this round.
