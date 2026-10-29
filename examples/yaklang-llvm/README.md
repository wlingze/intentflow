# yaklang · ssa2llvm 分支 demo

这是真实分支的切片，不是手写样例。

- 仓库：`yaklang`
- 工作区：`~/Developer/yaklang-workspace/feature-ssa2llvm-support_ci_and_mustpass_test`
- before：`main`
- after：`feature/ssa2llvm/support_ci_and_mustpass_test` 的 HEAD
- 范围：`common/yak/ssa2llvm`（304 个文件）

没有把 11k 个 Go 文件整仓编译。SSA 编译器对整仓编译太重，而且这次分支
95 个改动文件里有 122 个落在这个子系统里。范围写在页面的 before/after
标签里，不假装是全仓结果。

重新导出（不删除已有目录）：

```bash
./generate.sh
```

打开工作台：

```bash
../../bin/intentflow serve \
  --before examples/yaklang-llvm/before \
  --after  examples/yaklang-llvm/after \
  --out    examples/yaklang-llvm/out \
  --addr   127.0.0.1:8124 \
  --before-label 'yaklang main · ssa2llvm' \
  --after-label  'yaklang llvm-ci · ssa2llvm' 
```

LLM 是可选的：

```bash
export INTENTFLOW_LLM_BASE_URL=http://127.0.0.1:23000/v1
export INTENTFLOW_LLM_API_KEY=...
export INTENTFLOW_LLM_MODEL=coder02
```

节点、边、行号只来自 SSA + SyntaxFlow；LLM 只读这些事实写摘要。
