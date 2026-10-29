package emit

import (
	"encoding/json"
	"html/template"
	"os"
	"path/filepath"

	"github.com/yaklang/intentflow/internal/model"
)

// Web 写出人类 review 用的静态页面。
//
// 页面是自包含的：样式、脚本、数据全部内联，不依赖网络。
// 图形由内联 JSON 在浏览器里排布，服务端只负责把事实投影成稳定的数据结构。
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

	raw, err := json.Marshal(r)
	if err != nil {
		return "", err
	}

	data := struct {
		*model.Review
		JSON     template.JS
		HasGraph bool
	}{
		Review:   r,
		JSON:     template.JS(raw),
		HasGraph: len(r.Intent.Added)+len(r.Intent.Removed) > 0,
	}

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
	if err := tpl.Execute(f, data); err != nil {
		return "", err
	}
	return p, nil
}

const pageTemplate = `<!doctype html>
<html lang="zh-CN" data-theme="dark" data-pref="system">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>intentflow · 语义 diff</title>
<script>
(function(){
  var KEY='intentflow-theme';
  var prefs=['system','light','dark'];
  var forced=new URLSearchParams(location.search).get('theme');
  var pref=forced && prefs.indexOf(forced)>=0 ? forced : (localStorage.getItem(KEY)||'system');
  if(prefs.indexOf(pref)<0) pref='system';
  var mq=window.matchMedia('(prefers-color-scheme: light)');
  function resolved(p){ return p==='system' ? (mq.matches?'light':'dark') : p; }
  document.documentElement.dataset.pref=pref;
  document.documentElement.dataset.theme=resolved(pref);
  window.__intentflowTheme={pref:pref,forced:!!forced,resolved:resolved};
})();
</script>
<style>
  :root{
    --bg:#090c11; --bg-soft:#0c1017; --panel:#111721; --panel-2:#0d131b;
    --line:#1d2633; --line-2:#283444; --ink:#e7edf6; --dim:#8796ab; --faint:#5b6a7e;
    --add:#3ddc97; --add-soft:rgba(61,220,151,.12); --add-line:rgba(61,220,151,.38);
    --del:#ff6b81; --del-soft:rgba(255,107,129,.12); --del-line:rgba(255,107,129,.38);
    --warn:#f5c451; --warn-soft:rgba(245,196,81,.12);
    --info:#6cb6ff; --info-soft:rgba(108,182,255,.12);
    --accent:#5eead4; --accent-soft:rgba(94,234,212,.12);
    --grid:rgba(255,255,255,.025); --halo:var(--panel-2);
    --mono:ui-monospace,SFMono-Regular,"JetBrains Mono",Menlo,Consolas,monospace;
    --sans:ui-sans-serif,system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
    color-scheme:dark;
  }
  [data-theme="light"]{
    --bg:#f5f4ef; --bg-soft:#efece4; --panel:#fffefb; --panel-2:#f4f1e9;
    --line:#dfdbd0; --line-2:#c9c3b5; --ink:#1b2026; --dim:#5e6672; --faint:#8b919b;
    --add:#0c7f57; --add-soft:#e2f4ec; --add-line:rgba(12,127,87,.36);
    --del:#be2f45; --del-soft:#fbe8eb; --del-line:rgba(190,47,69,.36);
    --warn:#8d6200; --warn-soft:#fbf1d8;
    --info:#1266ad; --info-soft:#e4f0fa;
    --accent:#0f766e; --accent-soft:#dff2ef;
    --grid:rgba(20,30,40,.035); --halo:var(--panel-2);
    color-scheme:light;
  }
  *{box-sizing:border-box}
  html{background:var(--bg)}
  body{
    margin:0;color:var(--ink);font:14px/1.6 var(--sans);
    background:
      radial-gradient(900px 480px at 12% -8%,var(--accent-soft),transparent 62%),
      radial-gradient(760px 420px at 96% 4%,var(--info-soft),transparent 60%),
      linear-gradient(var(--grid) 1px,transparent 1px),
      linear-gradient(90deg,var(--grid) 1px,transparent 1px),
      var(--bg);
    background-size:auto,auto,28px 28px,28px 28px,auto;
  }
  a{color:var(--accent)}
  code,pre{font-family:var(--mono)}
  .top{
    position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:16px;
    padding:12px 28px;border-bottom:1px solid var(--line);
    background:color-mix(in srgb,var(--bg) 82%,transparent);
    backdrop-filter:blur(12px);
  }
  .brand{display:flex;align-items:center;gap:9px;font-weight:650;letter-spacing:-.02em}
  .brand .mark{
    width:22px;height:22px;border-radius:7px;display:grid;place-items:center;
    background:var(--accent-soft);color:var(--accent);border:1px solid var(--add-line);
    font:600 11px/1 var(--mono);
  }
  .brand span{color:var(--dim);font-weight:400}
  .top .spacer{flex:1}
  .theme{
    display:flex;gap:2px;padding:3px;border:1px solid var(--line);border-radius:9px;
    background:var(--panel-2);
  }
  .theme button{
    appearance:none;border:0;background:transparent;color:var(--dim);cursor:pointer;
    font:12px/1 var(--sans);padding:7px 10px;border-radius:6px;display:flex;align-items:center;gap:5px;
  }
  .theme button:hover{color:var(--ink)}
  .theme button[aria-pressed="true"]{background:var(--panel);color:var(--ink);box-shadow:0 1px 0 var(--line-2)}
  .theme svg{width:13px;height:13px;stroke:currentColor;fill:none;stroke-width:1.6}
  .wrap{max-width:1280px;margin:0 auto;padding:34px 28px 72px}
  .eyebrow{
    font:11px/1 var(--mono);letter-spacing:.16em;color:var(--accent);
    text-transform:uppercase;margin-bottom:10px;
  }
  h1{margin:0 0 8px;font-size:clamp(26px,3.4vw,38px);line-height:1.15;letter-spacing:-.035em}
  h1 .thin{color:var(--dim);font-weight:400}
  .paths{display:flex;align-items:center;gap:8px;flex-wrap:wrap;color:var(--dim);font-size:12px}
  .paths code{background:var(--panel);border:1px solid var(--line);border-radius:4px;padding:2px 7px;color:var(--ink)}
  .paths .arrow{color:var(--faint)}
  .hero{margin-bottom:26px}
  .stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:22px}
  .stat{
    background:var(--panel);border:1px solid var(--line);border-radius:11px;padding:13px 15px;
    position:relative;overflow:hidden;
  }
  .stat:before{content:"";position:absolute;inset:0 auto 0 0;width:3px;background:var(--line-2)}
  .stat.intent:before{background:var(--add)}
  .stat.logic:before{background:var(--info)}
  .stat.project:before{background:var(--warn)}
  .stat.signal:before{background:var(--del)}
  .stat b{display:block;font:600 23px/1.2 var(--mono);letter-spacing:-.02em}
  .stat b span{display:inline}
  .stat b .plus{color:var(--add)} .stat b .minus{color:var(--del)}
  .stat span{display:block;margin-top:4px;color:var(--dim);font-size:11px;letter-spacing:.04em}
  .layout{display:grid;grid-template-columns:minmax(0,1fr) 310px;gap:18px;align-items:start}
  .panel{background:var(--panel);border:1px solid var(--line);border-radius:13px}
  .panel-head{
    display:flex;align-items:baseline;justify-content:space-between;gap:12px;
    padding:15px 17px 12px;border-bottom:1px solid var(--line);
  }
  .panel-head h2{margin:0;font-size:13px;letter-spacing:.02em}
  .panel-head em{font:11px/1.4 var(--mono);color:var(--faint);font-style:normal}
  .graph-scroll{overflow-x:auto;padding:4px 10px 2px}
  #flowgraph{display:block;width:100%;min-width:880px;height:auto}
  .graph-foot{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:10px 17px;border-top:1px solid var(--line);color:var(--faint);font-size:11px}
  .legend{display:flex;gap:12px;flex-wrap:wrap}
  .legend i{display:inline-block;width:18px;height:0;border-top:2px solid var(--add);vertical-align:middle;margin-right:5px}
  .legend i.del{border-top-color:var(--del);border-top-style:dashed}
  .legend i.same{border-top-color:var(--faint)}
  .legend i.mod{border-top-color:var(--warn)}
  .inspector{margin:12px 17px 16px;padding:11px 13px;border:1px solid var(--line);border-radius:9px;background:var(--panel-2);min-height:64px}
  .inspector .k{font:10px/1 var(--mono);letter-spacing:.12em;color:var(--faint);text-transform:uppercase}
  .inspector .t{font-size:13px;font-weight:600;margin-top:5px}
  .inspector .d{font-size:11.5px;color:var(--dim);margin-top:3px}
  .inspector pre{margin:7px 0 0;padding:7px 9px;background:var(--bg-soft);border:1px solid var(--line);border-radius:5px;font-size:10.5px;line-height:1.5;color:var(--dim);white-space:pre-wrap;word-break:break-all;max-height:92px;overflow:auto}
  .side{position:sticky;top:66px}
  .side .panel-head{padding-bottom:11px}
  .signals{padding:10px 12px 13px;display:flex;flex-direction:column;gap:8px;max-height:560px;overflow:auto}
  .sig{border:1px solid var(--line);border-left:3px solid var(--faint);border-radius:7px;padding:9px 10px;background:var(--panel-2)}
  .sig.high{border-left-color:var(--del)} .sig.warn{border-left-color:var(--warn)} .sig.info{border-left-color:var(--info)}
  .sig .st{font-size:12px;font-weight:600;line-height:1.45}
  .sig .sd{font-size:11px;color:var(--dim);margin-top:3px}
  .sig .sev{font:9px/1 var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--faint);display:block;margin-bottom:4px}
  .sig.high .sev{color:var(--del)} .sig.warn .sev{color:var(--warn)} .sig.info .sev{color:var(--info)}
  .notes{margin-top:16px;display:flex;flex-direction:column;gap:7px}
  .note{
    display:flex;gap:9px;align-items:flex-start;padding:9px 12px;border:1px solid var(--line);
    border-left:3px solid var(--warn);border-radius:7px;background:var(--warn-soft);
    color:var(--ink);font-size:11.5px;
  }
  .note b{color:var(--warn);font:10px/1.6 var(--mono);letter-spacing:.08em;text-transform:uppercase;white-space:nowrap}
  .layers{margin-top:26px;display:flex;flex-direction:column;gap:10px}
  details.layer{background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden}
  details.layer>summary{
    list-style:none;cursor:pointer;display:flex;align-items:center;gap:12px;
    padding:14px 17px;background:var(--panel);
  }
  details.layer>summary::-webkit-details-marker{display:none}
  details.layer>summary:hover{background:var(--panel-2)}
  details.layer>summary .chev{width:7px;height:7px;border-right:1.5px solid var(--faint);border-bottom:1.5px solid var(--faint);transform:rotate(-45deg);transition:transform .15s;margin-right:2px}
  details[open].layer>summary .chev{transform:rotate(45deg)}
  details.layer>summary .lt{font-weight:650;font-size:13px}
  details.layer>summary .ld{color:var(--faint);font-size:11px}
  details.layer>summary .counts{margin-left:auto;font:11px/1 var(--mono);display:flex;gap:9px}
  .counts .a{color:var(--add)} .counts .r{color:var(--del)}
  .facts{padding:4px 17px 14px}
  .fact{
    padding:10px 0;border-top:1px solid var(--line);cursor:default;
  }
  .fact[data-identity]{cursor:pointer}
  .fact[data-identity]:hover{background:linear-gradient(90deg,var(--accent-soft),transparent 72%)}
  .fact.focus{background:linear-gradient(90deg,var(--accent-soft),transparent 72%)}
  .fh{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
  .sign{font:600 12px/1 var(--mono);width:12px;text-align:center}
  .sign.a{color:var(--add)} .sign.r{color:var(--del)}
  .ft{font-size:12.5px;font-weight:550}
  .tag{font:9px/1 var(--mono);letter-spacing:.05em;padding:3px 5px;border-radius:4px;background:var(--panel-2);color:var(--dim);border:1px solid var(--line)}
  .tag.EXTRACTED{color:var(--add);border-color:var(--add-line);background:var(--add-soft)}
  .tag.DERIVED{color:var(--info);border-color:rgba(108,182,255,.35);background:var(--info-soft)}
  .tag.INFERRED{color:#c084fc;border-color:rgba(192,132,252,.35);background:rgba(192,132,252,.1)}
  .fm{margin:3px 0 0 20px;font-size:10.5px;color:var(--faint);display:flex;gap:10px;flex-wrap:wrap}
  .fm b{font-weight:500;color:var(--dim)}
  .snippet{
    display:block;margin:7px 0 0 20px;padding:7px 9px;background:var(--bg-soft);
    border:1px solid var(--line);border-radius:5px;font-size:10.5px;line-height:1.5;
    color:var(--dim);white-space:pre-wrap;word-break:break-all;
  }
  .empty{padding:16px 17px;color:var(--faint);font-size:12px}
  .foot{margin-top:30px;padding-top:16px;border-top:1px solid var(--line);color:var(--faint);font-size:11px;display:flex;gap:16px;flex-wrap:wrap}
  .foot span b{color:var(--dim);font-weight:500}
  #tip{
    position:fixed;z-index:50;pointer-events:none;max-width:340px;padding:9px 11px;
    background:var(--panel);border:1px solid var(--line-2);border-radius:7px;
    box-shadow:0 12px 30px rgba(0,0,0,.35);font-size:11.5px;line-height:1.5;
    color:var(--ink);opacity:0;transform:translateY(4px);transition:opacity .12s,transform .12s;
  }
  #tip.on{opacity:1;transform:none}
  #tip .tt{font-weight:650;margin-bottom:2px}
  #tip .td{color:var(--dim);font-size:10.5px}
  #tip .ts{margin-top:5px;font:10px/1.45 var(--mono);color:var(--faint);white-space:pre-wrap;word-break:break-all}
  .node{cursor:pointer;outline:none}
  .node rect.card{transition:filter .15s,stroke-opacity .15s,opacity .15s}
  .node:hover rect.card,.node:focus-visible rect.card{filter:brightness(1.12)}
  .node.faded{opacity:.22}
  .edge{transition:opacity .15s}
  .edge.faded{opacity:.12}
  .edge path.line{transition:stroke-width .12s}
  .edge:hover path.line{stroke-width:2.6}
  .edge.selected path.line{stroke-width:3}
  .node.selected rect.card{stroke-width:2}
  @media (max-width:900px){
    .layout{grid-template-columns:1fr}
    .side{position:static}
    .stats{grid-template-columns:repeat(2,minmax(0,1fr))}
    .wrap{padding:24px 16px 56px}
    .top{padding:10px 16px}
  }
  @media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
</style>
</head>
<body>
<div class="top">
  <div class="brand"><span class="mark">if</span>intentflow <span>/ 语义 diff</span></div>
  <div class="spacer"></div>
  <div class="theme" role="group" aria-label="主题">
    <button type="button" data-pref="system" title="跟随系统">
      <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>系统</button>
    <button type="button" data-pref="light" title="浅色">
      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/></svg>浅色</button>
    <button type="button" data-pref="dark" title="深色">
      <svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z"/></svg>深色</button>
  </div>
</div>

<div class="wrap">
  <section class="hero">
    <div class="eyebrow">semantic diff · three layers</div>
    <h1>这次改动，<span class="thin">语义上做了什么</span></h1>
    <div class="paths"><code>{{.Before}}</code><span class="arrow">→</span><code>{{.After}}</code></div>
    <div class="stats">
      <div class="stat intent"><b><span class="plus">+{{len .Intent.Added}}</span> <span class="minus">−{{len .Intent.Removed}}</span></b><span>意图层 · 数据流链</span></div>
      <div class="stat logic"><b><span class="plus">+{{len .Logic.Added}}</span> <span class="minus">−{{len .Logic.Removed}}</span></b><span>逻辑层 · 调用边</span></div>
      <div class="stat project"><b><span class="plus">+{{len .Project.Added}}</span> <span class="minus">−{{len .Project.Removed}}</span></b><span>项目层 · 依赖与函数</span></div>
      <div class="stat signal"><b>{{len .Signals}}</b><span>Review 关注点</span></div>
    </div>
  </section>

  <div class="layout">
    <div>
      <section class="panel" aria-label="意图流图">
        <div class="panel-head">
          <h2>意图流图</h2>
          <em>来源 → 函数链 → 副作用 · 颜色表示增删</em>
        </div>
        {{if .HasGraph}}
        <div class="graph-scroll"><svg id="flowgraph" role="img" aria-label="意图数据流图"></svg></div>
        <div class="graph-foot">
          <div class="legend">
            <span><i></i>新增</span>
            <span><i class="del"></i>移除</span>
            <span><i class="mod"></i>结构变化</span>
            <span><i class="same"></i>未变</span>
          </div>
          <span style="margin-left:auto">悬停看细节 · 点击固定</span>
        </div>
        <div class="inspector" id="inspector">
          <div class="k">inspector</div>
          <div class="t">点击图上的节点或边</div>
          <div class="d">每条边都来自两侧 IR 做差；标签标出数据「如何」到达。</div>
        </div>
        {{else}}
        <div class="empty">本次改动没有可绘制的意图链。可能两侧都没有命中 sink，或 SSA 未启用。</div>
        {{end}}
      </section>

      {{if .Notes}}
      <div class="notes">
        {{range .Notes}}<div class="note"><b>note</b><span>{{.}}</span></div>{{end}}
      </div>
      {{end}}
    </div>

    <aside class="side">
      <section class="panel">
        <div class="panel-head"><h2>Review 关注点</h2><em>由事实派生</em></div>
        {{if .Signals}}
        <div class="signals">
          {{range .Signals}}
          <div class="sig {{.Severity}}">
            <span class="sev">{{.Severity}}</span>
            <div class="st">{{.Title}}</div>
            {{if .Detail}}<div class="sd">{{.Detail}}</div>{{end}}
          </div>
          {{end}}
        </div>
        {{else}}
        <div class="empty">没有规则命中。这不等于没有风险。</div>
        {{end}}
      </section>
    </aside>
  </div>

  <div class="layers">
    <details class="layer" open>
      <summary><span class="chev"></span><span class="lt">意图层</span><span class="ld">数据从哪来，流到什么副作用</span>
        <span class="counts"><span class="a">+{{len .Intent.Added}}</span><span class="r">−{{len .Intent.Removed}}</span></span>
      </summary>
      <div class="facts">
        {{if .Intent.Empty}}<div class="empty">意图层无变化。</div>{{end}}
        {{range .Intent.Added}}{{template "fact" dict . "+"}}{{end}}
        {{range .Intent.Removed}}{{template "fact" dict . "-"}}{{end}}
      </div>
    </details>

    <details class="layer">
      <summary><span class="chev"></span><span class="lt">逻辑结构层</span><span class="ld">谁调用了谁</span>
        <span class="counts"><span class="a">+{{len .Logic.Added}}</span><span class="r">−{{len .Logic.Removed}}</span></span>
      </summary>
      <div class="facts">
        {{if .Logic.Empty}}<div class="empty">逻辑结构层无变化。</div>{{end}}
        {{range .Logic.Added}}{{template "fact" dict . "+"}}{{end}}
        {{range .Logic.Removed}}{{template "fact" dict . "-"}}{{end}}
      </div>
    </details>

    <details class="layer">
      <summary><span class="chev"></span><span class="lt">项目结构层</span><span class="ld">依赖与函数定义的增删</span>
        <span class="counts"><span class="a">+{{len .Project.Added}}</span><span class="r">−{{len .Project.Removed}}</span></span>
      </summary>
      <div class="facts">
        {{if .Project.Empty}}<div class="empty">项目结构层无变化。</div>{{end}}
        {{range .Project.Added}}{{template "fact" dict . "+"}}{{end}}
        {{range .Project.Removed}}{{template "fact" dict . "-"}}{{end}}
      </div>
    </details>
  </div>

  <div class="foot">
    <span><b>EXTRACTED</b> AST/IR 直接可复现</span>
    <span><b>DERIVED</b> 由 IR 事实经规则推出</span>
    <span><b>INFERRED</b> LLM 推断，需人工确认</span>
  </div>
</div>

<div id="tip" role="tooltip"></div>

<script id="review-data" type="application/json">{{.JSON}}</script>
<script>
(function(){
  'use strict';
  var R=JSON.parse(document.getElementById('review-data').textContent);
  var NS='http://www.w3.org/2000/svg';
  var SVG=document.getElementById('flowgraph');
  var TIP=document.getElementById('tip');
  var INSP=document.getElementById('inspector');

  // ---- theme ----
  var mq=window.matchMedia('(prefers-color-scheme: light)');
  var themeState=window.__intentflowTheme||{pref:'system',forced:false,resolved:function(p){return p;}};
  function resolve(p){return p==='system'?(mq.matches?'light':'dark'):p;}
  function applyTheme(pref,save){
    document.documentElement.dataset.pref=pref;
    document.documentElement.dataset.theme=resolve(pref);
    var buttons=document.querySelectorAll('[data-pref]');
    for(var i=0;i<buttons.length;i++){
      buttons[i].setAttribute('aria-pressed',buttons[i].dataset.pref===pref?'true':'false');
    }
    if(save && !themeState.forced){try{localStorage.setItem('intentflow-theme',pref);}catch(e){}}
  }
  applyTheme(themeState.pref,false);
  var themeButtons=document.querySelectorAll('.theme [data-pref]');
  for(var ti=0;ti<themeButtons.length;ti++){
    themeButtons[ti].addEventListener('click',function(){applyTheme(this.dataset.pref,true);});
  }
  var onScheme=function(){if(document.documentElement.dataset.pref==='system'){document.documentElement.dataset.theme=resolve('system');}};
  if(mq.addEventListener){mq.addEventListener('change',onScheme);}else if(mq.addListener){mq.addListener(onScheme);}

  if(!SVG) return;

  // ---- labels ----
  var SOURCE={http_input:'HTTP 输入',env:'环境变量',literal:'字面量',file:'文件',db:'数据库',unknown:'未知来源'};
  var CATEGORY={sql:'SQL 执行',file:'文件读写',exec:'命令执行',net:'网络请求',template:'模板渲染',unknown:'副作用'};
  var SHAPE={direct:'参数化直传',format:'格式化拼接',concat:'字符串拼接',member:'成员访问',call:'函数调用',unknown:'未知形态'};

  function sourceLabel(s){return SOURCE[s]||(s?String(s):'未知来源');}
  function categoryLabel(c){return CATEGORY[c]||(c?String(c):'副作用');}
  function shapeLabel(s){return SHAPE[s]||(s?String(s):'未知形态');}
  function short(s,n){s=String(s==null?'':s);return s.length>n?s.slice(0,n-1)+'…':s;}

  // ---- model ----
  var chains=[], byFact={}, idx=0;
  [['added','+'],['removed','-']].forEach(function(pair){
    var key=pair[0], sign=pair[1];
    (R.intent[key]||[]).forEach(function(f){
      var id='chain-'+sign+'-'+idx;
      var steps=(f.path||[]).slice().reverse();
      if(f.function && (!steps.length || steps[steps.length-1]!==f.function)) steps.push(f.function);
      var c={id:id,sign:sign,fact:f,steps:steps,source:f.source||'unknown',category:f.category||'unknown',shape:f.shape||'unknown'};
      c.branch=c.source+'|'+steps.join('>');
      chains.push(c); byFact[f.identity]=id; idx++;
    });
  });
  var branchRow={}, branchCount=0;
  chains.forEach(function(c){if(!(c.branch in branchRow)){branchRow[c.branch]=branchCount++;} c.row=branchRow[c.branch];});

  var nodes={}, edges={}, nodeOrder=[];
  function touchNode(key,make){
    var n=nodes[key];
    if(!n){n=make();n.signs=[];n.chains=[];n.rows=[];n.shapes=[];nodes[key]=n;nodeOrder.push(key);}
    return n;
  }
  function pushUnique(arr,v){if(arr.indexOf(v)<0)arr.push(v);}

  chains.forEach(function(c){
    var srcKey='src:'+c.source;
    var src=touchNode(srcKey,function(){return {key:srcKey,kind:'source',label:sourceLabel(c.source),sub:'来源',depth:0};});
    pushUnique(src.signs,c.sign);pushUnique(src.chains,c.id);src.rows.push(c.row);

    var keys=[srcKey],depth=1;
    c.steps.forEach(function(name){
      var k='fn:'+name;
      var n=touchNode(k,function(){return {key:k,kind:'function',label:name,sub:'函数',depth:depth};});
      if(depth>n.depth)n.depth=depth;
      pushUnique(n.signs,c.sign);pushUnique(n.chains,c.id);n.rows.push(c.row);
      keys.push(k);depth++;
    });
    var sinkKey='sink:'+c.category;
    var sink=touchNode(sinkKey,function(){return {key:sinkKey,kind:'sink',label:categoryLabel(c.category),sub:'副作用',depth:depth};});
    if(depth>sink.depth)sink.depth=depth;
    pushUnique(sink.signs,c.sign);pushUnique(sink.chains,c.id);sink.rows.push(c.row);pushUnique(sink.shapes,c.shape);
    keys.push(sinkKey);
    c.nodeKeys=keys;
  });

  // node delta
  Object.keys(nodes).forEach(function(k){
    var n=nodes[k];
    if(n.signs.length===2){
      n.delta=(n.kind==='sink' && n.shapes.length>1)?'modified':'unchanged';
    }else{
      n.delta=n.signs[0]==='+'?'added':'removed';
    }
  });

  chains.forEach(function(c){
    for(var i=0;i<c.nodeKeys.length-1;i++){
      var from=c.nodeKeys[i],to=c.nodeKeys[i+1];
      var last=(i===c.nodeKeys.length-2);
      var ek=last?(from+'>'+to+'|'+c.shape):(from+'>'+to);
      var e=edges[ek];
      if(!e){e={key:ek,from:from,to:to,last:last,shape:c.shape,signs:[],chains:[]};edges[ek]=e;}
      pushUnique(e.signs,c.sign);pushUnique(e.chains,c.id);
      if(!e.fact)e.fact=c.fact;
    }
  });
  Object.keys(edges).forEach(function(k){
    var e=edges[k];
    if(e.signs.length===2){e.delta='unchanged';e.fact=null;}
    else e.delta=e.signs[0]==='+'?'added':'removed';
  });

  // ---- layout ----
  var depths=Object.keys(nodes).map(function(k){return nodes[k].depth;});
  var maxDepth=Math.max.apply(null,depths.concat([0]));
  // 副作用节点固定在最右列，不按路径深度散落。
  // 否则短链的 sink 会落在函数泳道里，读图时层语义就错了。
  var maxFnDepth=0;
  Object.keys(nodes).forEach(function(k){var n=nodes[k];if(n.kind==='function')maxFnDepth=Math.max(maxFnDepth,n.depth);});
  var lastCol=maxFnDepth>0?maxFnDepth+1:1;
  Object.keys(nodes).forEach(function(k){
    var n=nodes[k];
    n._col=n.kind==='source'?0:(n.kind==='sink'?lastCol:Math.max(1,Math.min(n.depth,lastCol-1)));
  });
  var cols=lastCol+1;
  var rowCount=Math.max(branchCount,1);
  var NODE_W=178,NODE_H=58,GAP_X=76,GAP_Y=48,LEFT=42,TOP=96,BOTTOM=48;
  var width=LEFT*2+cols*NODE_W+(cols-1)*GAP_X;
  var height=TOP+rowCount*NODE_H+(rowCount-1)*GAP_Y+BOTTOM;
  SVG.setAttribute('viewBox','0 0 '+width+' '+height);
  SVG.setAttribute('width',width);
  SVG.setAttribute('height',height);

  function el(tag,attrs,parent){
    var n=document.createElementNS(NS,tag);
    if(attrs)Object.keys(attrs).forEach(function(a){n.setAttribute(a,attrs[a]);});
    if(parent)parent.appendChild(n);
    return n;
  }

  // defs
  var defs=el('defs',null,SVG);
  [['arrow-add','var(--add)'],['arrow-del','var(--del)'],['arrow-same','var(--faint)'],['arrow-mod','var(--warn)']].forEach(function(p){
    var m=el('marker',{id:p[0],viewBox:'0 0 10 10',refX:'9',refY:'5',markerWidth:'7',markerHeight:'7',orient:'auto-start-reverse'},defs);
    el('path',{d:'M 0 0 L 10 5 L 0 10 z',fill:p[1]},m);
  });

  // lane bands
  var bandTop=TOP-24,bandH=height-TOP-BOTTOM+42;
  function band(fromDepth,toDepth,label,align){
    if(toDepth<fromDepth)return;
    var x=LEFT+fromDepth*(NODE_W+GAP_X)-16;
    var x2=LEFT+toDepth*(NODE_W+GAP_X)+NODE_W+16;
    var g=el('g',{class:'lane'},SVG);
    el('rect',{x:x,y:bandTop,width:Math.max(0,x2-x),height:bandH,rx:'12',fill:'var(--panel-2)','fill-opacity':'.55',stroke:'var(--line)','stroke-dasharray':'3 5'},g);
    var t=el('text',{x:align==='end'?x2-14:(x+18),y:bandTop+20,fill:'var(--faint)','font-size':'10.5','font-family':'var(--mono)','letter-spacing':'.08em','text-anchor':align==='end'?'end':'start'},g);
    t.textContent=label;
  }
  band(0,0,'SOURCE');
  if(cols>2)band(1,cols-2,'INTENT PATH');
  band(cols-1,cols-1,'SINK','end');

  // column -> nodes
  var columns={};
  Object.keys(nodes).forEach(function(k){
    var n=nodes[k];
    if(!columns[n._col])columns[n._col]=[];
    columns[n._col].push(n);
  });
  Object.keys(columns).forEach(function(d){
    var list=columns[d];
    list.sort(function(a,b){
      var ar=Math.min.apply(null,a.rows),br=Math.min.apply(null,b.rows);
      return ar-br||String(a.label).localeCompare(String(b.label));
    });
    var used={};
    list.forEach(function(n){
      var pref=Math.min.apply(null,n.rows);
      while(used[pref])pref++;
      used[pref]=true;
      n._row=pref;
      n._x=LEFT+Number(d)*(NODE_W+GAP_X);
      n._y=TOP+pref*(NODE_H+GAP_Y);
    });
  });
  // grow if a column overflowed
  var usedRows=0;
  Object.keys(nodes).forEach(function(k){usedRows=Math.max(usedRows,nodes[k]._row+1);});
  if(usedRows>rowCount){
    rowCount=usedRows;
    height=TOP+rowCount*NODE_H+(rowCount-1)*GAP_Y+BOTTOM;
    SVG.setAttribute('viewBox','0 0 '+width+' '+height);
    SVG.setAttribute('height',height);
    Object.keys(nodes).forEach(function(k){
      nodes[k]._y=TOP+nodes[k]._row*(NODE_H+GAP_Y);
    });
  }

  function nodeCenter(n,side){
    return {x:side==='right'?n._x+NODE_W:(side==='left'?n._x:n._x+NODE_W/2),y:n._y+NODE_H/2};
  }

  // edges first
  var edgeLayer=el('g',{class:'edges'},SVG);
  var parallel={};
  Object.keys(edges).forEach(function(k){
    var e=edges[k];var from=nodes[e.from],to=nodes[e.to];
    if(!from||!to)return;
    var pk=e.from+'>'+e.to;
    parallel[pk]=(parallel[pk]||0)+1;
    e._par=parallel[pk]-1;
  });
  var pathSeq=0;
  Object.keys(edges).forEach(function(k){
    var e=edges[k];var from=nodes[e.from],to=nodes[e.to];
    if(!from||!to)return;
    var p1=nodeCenter(from,'right'),p2=nodeCenter(to,'left');
    var total=parallel[e.from+'>'+e.to];
    var off=(e._par-(total-1)/2)*28;
    var dx=Math.max(46,(p2.x-p1.x)*.46);
    var y1=p1.y,y2=p2.y;
    var d='M '+p1.x+' '+y1+' C '+(p1.x+dx)+' '+(y1+off)+', '+(p2.x-dx)+' '+(y2+off)+', '+p2.x+' '+y2;
    var g=el('g',{class:'edge',tabindex:'0',role:'button','data-edge':k},edgeLayer);
    var color=e.delta==='added'?'var(--add)':e.delta==='removed'?'var(--del)':e.delta==='modified'?'var(--warn)':'var(--faint)';
    var arrow=e.delta==='added'?'arrow-add':e.delta==='removed'?'arrow-del':e.delta==='modified'?'arrow-mod':'arrow-same';
    var p=el('path',{d:d,fill:'none',stroke:color,'stroke-width':e.delta==='unchanged'?'1.5':'2','stroke-dasharray':e.delta==='removed'?'5 5':'none','stroke-opacity':e.delta==='unchanged'?'.75':'1','marker-end':'url(#'+arrow+')'},g);
    p.setAttribute('class','line');
    var hit=el('path',{d:d,fill:'none',stroke:'transparent','stroke-width':'16'},g);
    hit.setAttribute('class','hit');
    var midx=(p1.x+p2.x)/2,midy=(y1+y2)/2+off;
    var label=e.last?shapeLabel(e.shape):(from.kind==='source'?'输入':'调用');
    var sign=e.delta==='added'?'+ ':e.delta==='removed'?'− ':'';
    var labelY=total>1?(off<0?midy-12:midy+20):midy-9;
    var txt=el('text',{x:midx,y:labelY,'text-anchor':'middle','font-size':'10','font-family':'var(--mono)',fill:color,stroke:'var(--halo)','stroke-width':'5','paint-order':'stroke','stroke-linejoin':'round'},g);
    txt.textContent=sign+label;
    if(e.delta==='added'&&e.last){
      var pid='edgepath-'+pathSeq++;
      p.setAttribute('id',pid);
      if(!window.matchMedia('(prefers-reduced-motion: reduce)').matches){
        var dot=el('circle',{r:'3.2',fill:'var(--add)','fill-opacity':'.95'},g);
        var am=el('animateMotion',{dur:'3.4s',repeatCount:'indefinite'},dot);
        var mp=el('mpath',{},am);mp.setAttribute('href','#'+pid);
      }
    }
    e._el=g;e._path=p;e._label=txt;
  });

  // nodes last
  var nodeLayer=el('g',{class:'nodes'},SVG);
  Object.keys(nodes).forEach(function(k){
    var n=nodes[k];
    var g=el('g',{class:'node',tabindex:'0',role:'button','data-node':k},nodeLayer);
    var color=n.delta==='added'?'var(--add)':n.delta==='removed'?'var(--del)':n.delta==='modified'?'var(--warn)':'var(--line-2)';
    el('rect',{class:'card',x:n._x,y:n._y,width:NODE_W,height:NODE_H,rx:'10',fill:'var(--panel)',stroke:color,'stroke-width':n.delta==='unchanged'?'1':'1.6','stroke-dasharray':n.delta==='removed'?'5 4':'none'},g);
    var badge=el('rect',{x:n._x+12,y:n._y+13,width:'30',height:'30',rx:'8',fill:n.delta==='added'?'var(--add-soft)':n.delta==='removed'?'var(--del-soft)':n.delta==='modified'?'var(--warn-soft)':'var(--panel-2)',stroke:color,'stroke-opacity':'.5'},g);
    var glyph=el('text',{x:n._x+27,y:n._y+33,'text-anchor':'middle','font-size':'11','font-family':'var(--mono)',fill:color},g);
    glyph.textContent=n.kind==='source'?'IN':n.kind==='sink'?'OUT':'ƒ';
    var title=el('text',{x:n._x+51,y:n._y+25,'font-size':'12.5','font-weight':'600',fill:'var(--ink)'},g);
    title.textContent=short(n.label,18);
    var sub=el('text',{x:n._x+51,y:n._y+41,'font-size':'10',fill:'var(--faint)','font-family':'var(--mono)'},g);
    sub.textContent=(n.delta==='modified'&&n.kind==='sink')?'副作用 · 形态变化':n.sub;
    var mark=n.delta==='added'?'+':n.delta==='removed'?'−':n.delta==='modified'?'~':'';
    if(mark){
      var mt=el('text',{x:n._x+NODE_W-13,y:n._y+20,'text-anchor':'end','font-size':'12','font-weight':'700',fill:color},g);
      mt.textContent=mark;
    }
    n._el=g;
    g.addEventListener('mouseenter',function(){showTipNode(n);});
    g.addEventListener('mouseleave',hideTip);
    g.addEventListener('focus',function(){showTipNode(n);});
    g.addEventListener('blur',hideTip);
    g.addEventListener('click',function(ev){ev.stopPropagation();selectNode(n);});
    g.addEventListener('keydown',function(ev){if(ev.key==='Enter'||ev.key===' '){ev.preventDefault();selectNode(n);}});
  });

  // ---- interaction ----
  var selection=null;
  function clearSelection(){
    selection=null;
    Object.keys(nodes).forEach(function(k){nodes[k]._el.classList.remove('selected','faded');});
    Object.keys(edges).forEach(function(k){edges[k]._el.classList.remove('selected','faded');});
    renderInspectorDefault();
  }
  function fadeExcept(kind,key){
    Object.keys(nodes).forEach(function(k){nodes[k]._el.classList.toggle('faded',kind!=='node'||k!==key);});
    Object.keys(edges).forEach(function(k){edges[k]._el.classList.toggle('faded',kind!=='edge'||k!==key);});
    if(kind==='node'&&nodes[key])nodes[key]._el.classList.remove('faded');
    if(kind==='edge'&&edges[key])edges[key]._el.classList.remove('faded');
  }
  function selectNode(n){
    selection={kind:'node',key:n.key};
    fadeExcept('node',n.key);
    n._el.classList.add('selected');
    var html='<div class="k">node · '+n.kind+'</div><div class="t">'+escapeHtml(n.label)+'</div><div class="d">'+escapeHtml(n.sub)+' · '+deltaText(n.delta)+' · 出现在 '+n.chains.length+' 条链</div>';
    var facts=chains.filter(function(c){return c.nodeKeys.indexOf(n.key)>=0;});
    if(facts.length){
      html+='<pre>'+facts.map(function(c){return (c.sign==='+'?'+ ':'− ')+c.fact.title;}).join('\n')+'</pre>';
    }
    INSP.innerHTML=html;
  }
  function selectEdge(e){
    selection={kind:'edge',key:e.key};
    fadeExcept('edge',e.key);
    e._el.classList.add('selected');
    var f=e.fact||{};
    var html='<div class="k">edge · '+e.delta+'</div><div class="t">'+escapeHtml(nodes[e.from].label)+' → '+escapeHtml(nodes[e.to].label)+'</div>';
    html+='<div class="d">'+escapeHtml(e.last?shapeLabel(e.shape):'调用边')+' · '+(f.confidence||'两侧相同')+' · '+deltaText(e.delta)+'</div>';
    if(e.delta==='unchanged')html+='<div class="d">这条边在 before 与 after 都存在，不产生语义 diff。</div>';
    if(f.detail)html+='<div class="d">'+escapeHtml(f.detail)+'</div>';
    if(f.snippet)html+='<pre>'+escapeHtml(f.snippet)+'</pre>';
    INSP.innerHTML=html;
  }
  function deltaText(d){return d==='added'?'新增':d==='removed'?'移除':d==='modified'?'结构变化':'未变';}
  function renderInspectorDefault(){
    INSP.innerHTML='<div class="k">inspector</div><div class="t">点击图上的节点或边</div><div class="d">每条边都来自两侧 IR 做差；标签标出数据「如何」到达。</div>';
  }
  function escapeHtml(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}

  Object.keys(edges).forEach(function(k){
    var e=edges[k];
    e._el.addEventListener('mouseenter',function(){showTipEdge(e);});
    e._el.addEventListener('mousemove',function(ev){moveTip(ev);});
    e._el.addEventListener('mouseleave',hideTip);
    e._el.addEventListener('focus',function(){showTipEdge(e);});
    e._el.addEventListener('blur',hideTip);
    e._el.addEventListener('click',function(ev){ev.stopPropagation();selectEdge(e);});
    e._el.addEventListener('keydown',function(ev){if(ev.key==='Enter'||ev.key===' '){ev.preventDefault();selectEdge(e);}});
  });
  SVG.addEventListener('click',function(){clearSelection();});

  function showTipNode(n){
    TIP.innerHTML='<div class="tt">'+escapeHtml(n.label)+'</div><div class="td">'+escapeHtml(n.sub)+' · '+deltaText(n.delta)+'</div>';
    TIP.classList.add('on');
  }
  function showTipEdge(e){
    var f=e.fact||{};
    TIP.innerHTML='<div class="tt">'+escapeHtml(nodes[e.from].label)+' → '+escapeHtml(nodes[e.to].label)+'</div><div class="td">'+deltaText(e.delta)+(e.last?' · '+escapeHtml(shapeLabel(e.shape)):'')+'</div>'+(f.snippet?'<div class="ts">'+escapeHtml(f.snippet)+'</div>':'');
    TIP.classList.add('on');
    var ev=window.event;
    if(ev)moveTip(ev);
  }
  function moveTip(ev){
    var x=ev.clientX+14,y=ev.clientY+14;
    var w=TIP.offsetWidth||300,h=TIP.offsetHeight||80;
    if(x+w>window.innerWidth-12)x=ev.clientX-w-14;
    if(y+h>window.innerHeight-12)y=ev.clientY-h-14;
    TIP.style.left=x+'px';TIP.style.top=y+'px';
  }
  function hideTip(){TIP.classList.remove('on');}

  // list <-> graph
  var factEls=document.querySelectorAll('.fact[data-identity]');
  for(var fi=0;fi<factEls.length;fi++){
    (function(node){
      var id=byFact[node.dataset.identity];
      if(!id)return;
      var chain=null;
      for(var ci=0;ci<chains.length;ci++){if(chains[ci].id===id){chain=chains[ci];break;}}
      function focus(){
        node.classList.add('focus');
        if(!chain)return;
        Object.keys(edges).forEach(function(k){edges[k]._el.classList.toggle('faded',edges[k].chains.indexOf(id)<0);});
        Object.keys(nodes).forEach(function(k){nodes[k]._el.classList.toggle('faded',chain.nodeKeys.indexOf(k)<0);});
      }
      function blur(){
        node.classList.remove('focus');
        if(selection){fadeExcept(selection.kind,selection.key);}
        else{Object.keys(edges).forEach(function(k){edges[k]._el.classList.remove('faded');});Object.keys(nodes).forEach(function(k){nodes[k]._el.classList.remove('faded');});}
      }
      node.addEventListener('mouseenter',focus);
      node.addEventListener('mouseleave',blur);
      node.addEventListener('click',function(){
        if(!chain)return;
        var last=null;
        Object.keys(edges).forEach(function(k){if(edges[k].chains.indexOf(id)>=0&&edges[k].last)last=edges[k];});
        if(last)selectEdge(last);
        if(SVG.scrollIntoView)SVG.scrollIntoView({behavior:'smooth',block:'center'});
      });
    })(factEls[fi]);
  }
})();
</script>
</body>
</html>

{{define "fact"}}
<div class="fact {{if eq .Sign "+"}}added{{else}}removed{{end}}" data-identity="{{.F.Identity}}">
  <div class="fh">
    <span class="sign {{if eq .Sign "+"}}a{{else}}r{{end}}">{{.Sign}}</span>
    <span class="ft">{{.F.Title}}</span>
    <span class="tag {{.F.Confidence}}">{{.F.Confidence}}</span>
  </div>
  <div class="fm">
    {{if .F.File}}<span>{{.F.File}}{{if .F.Line}}:{{.F.Line}}{{end}}</span>{{end}}
    {{if .F.Source}}<span>来源 <b>{{.F.Source}}</b></span>{{end}}
    {{if .F.Category}}<span>副作用 <b>{{.F.Category}}</b></span>{{end}}
    {{if .F.Shape}}<span>形态 <b>{{.F.Shape}}</b></span>{{end}}
    {{if .F.Function}}<span>函数 <b>{{.F.Function}}</b></span>{{end}}
  </div>
  {{if .F.Detail}}<div class="fm" style="margin-left:20px">{{.F.Detail}}</div>{{end}}
  {{if .F.Snippet}}<pre class="snippet">{{.F.Snippet}}</pre>{{end}}
</div>
{{end}}
`
