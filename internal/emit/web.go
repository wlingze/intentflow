package emit

import (
	"html/template"
	"os"
	"path/filepath"

	"github.com/yaklang/intentflow/internal/model"
)

// Web 写出人类 review 用的静态页面。
func Web(r *model.Review, dir string) (string, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	p := filepath.Join(dir, "index.html")
	f, err := os.Create(p)
	if err != nil {
		return "", err
	}
	defer f.Close()

	tpl, err := template.New("review").Funcs(template.FuncMap{
		// dict 把一条事实和它在 diff 里的方向（新增/移除）合成模板上下文。
		// Go 的 html/template 没有内建 dict，只能自己提供。
		"dict": func(f model.Fact, sign string) map[string]any {
			return map[string]any{"F": f, "Sign": sign}
		},
	}).Parse(pageTemplate)
	if err != nil {
		return "", err
	}
	if err := tpl.Execute(f, r); err != nil {
		return "", err
	}
	return p, nil
}

const pageTemplate = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>intentflow · 语义 diff</title>
<style>
  :root{
    --bg:#0b0e14; --panel:#131823; --line:#1f2734; --ink:#e6ebf3;
    --dim:#8290a5; --accent:#5eead4; --high:#f87171; --warn:#fbbf24; --info:#7dd3fc;
    --extracted:#34d399; --derived:#60a5fa; --inferred:#c084fc;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);
       font:14px/1.6 "JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace}
  header{padding:28px 32px 20px;border-bottom:1px solid var(--line)}
  h1{margin:0 0 6px;font-size:19px;letter-spacing:-.02em}
  h1 span{color:var(--accent)}
  .sub{color:var(--dim);font-size:12px}
  .stats{display:flex;gap:22px;margin-top:16px;flex-wrap:wrap}
  .stat b{display:block;font-size:20px;color:var(--ink)}
  .stat span{font-size:11px;color:var(--dim);text-transform:uppercase;letter-spacing:.06em}
  main{padding:0 32px 64px;max-width:1180px}
  section{margin-top:34px}
  h2{font-size:12px;text-transform:uppercase;letter-spacing:.1em;color:var(--dim);
     border-bottom:1px solid var(--line);padding-bottom:8px;display:flex;justify-content:space-between}
  h2 em{font-style:normal;color:var(--dim);font-size:11px}
  .note{background:#1a1408;border-left:3px solid var(--warn);padding:10px 14px;
        margin:10px 0;font-size:12px;color:#e5d5a8}
  .sig{background:var(--panel);border:1px solid var(--line);border-left-width:3px;
       border-radius:5px;padding:11px 14px;margin:8px 0}
  .sig.high{border-left-color:var(--high)} .sig.warn{border-left-color:var(--warn)}
  .sig.info{border-left-color:var(--info)}
  .sig .t{font-weight:600}
  .sig .d{color:var(--dim);font-size:12px;margin-top:3px}
  .fact{display:grid;grid-template-columns:66px 1fr;gap:12px;
        padding:9px 0;border-bottom:1px solid #151b26}
  .fact:last-child{border-bottom:none}
  .badge{font-size:10px;padding:2px 6px;border-radius:3px;text-align:center;
         height:fit-content;letter-spacing:.04em}
  .EXTRACTED{background:#0d2f24;color:var(--extracted)}
  .DERIVED{background:#0d1f39;color:var(--derived)}
  .INFERRED{background:#241539;color:var(--inferred)}
  .ASSERTED{background:#332a10;color:var(--warn)}
  .UNKNOWN{background:#22262e;color:var(--dim)}
  .add{color:var(--extracted)} .del{color:var(--high)}
  .f-title{font-size:13px}
  .f-loc{color:var(--dim);font-size:11px;margin-top:2px}
  .f-detail{color:var(--dim);font-size:11px;margin-top:2px}
  code{background:#0a0d13;border:1px solid var(--line);border-radius:3px;
       padding:1px 5px;font-size:11px;color:#a8b6cc}
  .empty{color:var(--dim);font-size:12px;padding:10px 0}
  .legend{margin-top:12px;font-size:11px;color:var(--dim)}
  .legend b{font-weight:400;margin-right:14px}
</style>
</head>
<body>
<header>
  <h1>intentflow · <span>语义 diff</span></h1>
  <div class="sub">改动前 {{.Before}} &nbsp;→&nbsp; 改动后 {{.After}}</div>
  <div class="stats">
    <div class="stat"><b>{{len .Intent.Added}}/{{len .Intent.Removed}}</b><span>意图层 ±</span></div>
    <div class="stat"><b>{{len .Logic.Added}}/{{len .Logic.Removed}}</b><span>逻辑层 ±</span></div>
    <div class="stat"><b>{{len .Project.Added}}/{{len .Project.Removed}}</b><span>项目层 ±</span></div>
    <div class="stat"><b>{{len .Signals}}</b><span>Review 关注点</span></div>
  </div>
</header>

<main>
{{if .Notes}}
<section>
  <h2>运行说明 <em>非结论</em></h2>
  {{range .Notes}}<div class="note">{{.}}</div>{{end}}
</section>
{{end}}

<section>
  <h2>Review 关注点 <em>由三层事实派生</em></h2>
  {{if .Signals}}
    {{range .Signals}}
    <div class="sig {{.Severity}}">
      <div class="t">{{.Title}}</div>
      {{if .Detail}}<div class="d">{{.Detail}}</div>{{end}}
    </div>
    {{end}}
  {{else}}
    <div class="empty">本次改动未触发任何派生关注点。这不等于没有风险，只说明没有规则命中。</div>
  {{end}}
</section>

<section>
  <h2>意图层 <em>数据从哪里流到什么副作用 · {{len .Intent.Added}} 新增 / {{len .Intent.Removed}} 移除</em></h2>
  {{if .Intent.Empty}}
    <div class="empty">意图层无变化。</div>
  {{else}}
    {{range .Intent.Added}}{{template "fact" dict . "+"}}{{end}}
    {{range .Intent.Removed}}{{template "fact" dict . "-"}}{{end}}
  {{end}}
</section>

<section>
  <h2>逻辑结构层 <em>函数调用边 · {{len .Logic.Added}} 新增 / {{len .Logic.Removed}} 移除</em></h2>
  {{if .Logic.Empty}}
    <div class="empty">逻辑结构层无变化。</div>
  {{else}}
    {{range .Logic.Added}}{{template "fact" dict . "+"}}{{end}}
    {{range .Logic.Removed}}{{template "fact" dict . "-"}}{{end}}
  {{end}}
</section>

<section>
  <h2>项目结构层 <em>依赖与函数定义 · {{len .Project.Added}} 新增 / {{len .Project.Removed}} 移除</em></h2>
  {{if .Project.Empty}}
    <div class="empty">项目结构层无变化。</div>
  {{else}}
    {{range .Project.Added}}{{template "fact" dict . "+"}}{{end}}
    {{range .Project.Removed}}{{template "fact" dict . "-"}}{{end}}
  {{end}}
</section>

<div class="legend">
  <b>可信度：</b>
  <span class="badge EXTRACTED">EXTRACTED</span> 语法/IR 直接可复现 &nbsp;
  <span class="badge DERIVED">DERIVED</span> 由 IR 事实经规则推出 &nbsp;
  <span class="badge INFERRED">INFERRED</span> LLM 推断，需人工确认
</div>
</main>
</body>
</html>

{{define "fact"}}
<div class="fact">
  <div class="badge {{.F.Confidence}}">{{.F.Confidence}}</div>
  <div>
    <div class="f-title">
      <span class="{{if eq .Sign "+"}}add{{else}}del{{end}}">{{.Sign}}</span>
      {{.F.Title}}
    </div>
    {{if .F.File}}<div class="f-loc">{{.F.File}}{{if .F.Line}}:{{.F.Line}}{{end}}</div>{{end}}
    {{if .F.Detail}}<div class="f-detail">{{.F.Detail}}</div>{{end}}
    {{if .F.Snippet}}<div class="f-loc"><code>{{.F.Snippet}}</code></div>{{end}}
  </div>
</div>
{{end}}
`
