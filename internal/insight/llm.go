// Package insight 提供可选的 LLM 叙述层。
//
// 它只读已经算好的事实，不生成节点、边或行号。输出中的每条结论都必须
// 引用输入里出现过的证据；没有配置模型时返回 unavailable，分析照常进行。
package insight

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/yaklang/intentflow/internal/contract"
	"github.com/yaklang/intentflow/internal/model"
)

type Config struct {
	BaseURL string
	APIKey  string
	Model   string
	Timeout time.Duration
}

func ConfigFromEnv() Config {
	cfg := Config{
		BaseURL: strings.TrimSpace(os.Getenv("INTENTFLOW_LLM_BASE_URL")),
		APIKey:  strings.TrimSpace(os.Getenv("INTENTFLOW_LLM_API_KEY")),
		Model:   strings.TrimSpace(os.Getenv("INTENTFLOW_LLM_MODEL")),
		Timeout: 120 * time.Second,
	}
	if cfg.Model == "" {
		cfg.Model = "deepseek-v4.1-flash"
	}
	return cfg
}

// Analyze 生成 review 的中文叙述与风险清单。它不修改事实层。
func Analyze(ctx context.Context, review *model.Review, files []contract.CodeFile) model.AISummary {
	out := model.AISummary{
		Status:      "unavailable",
		Model:       "",
		Summary:     "",
		Risks:       []model.AIRisk{},
		Focus:       []string{},
		GeneratedAt: time.Now().Format(time.RFC3339),
	}
	cfg := ConfigFromEnv()
	if cfg.BaseURL == "" || cfg.APIKey == "" {
		out.Summary = "未配置 LLM 端点；当前只展示 SSA + SyntaxFlow 的确定性事实。"
		return out
	}
	out.Model = cfg.Model

	body, err := callResponses(ctx, cfg, buildPrompt(review, files))
	if err != nil {
		out.Status = "error"
		out.Summary = "LLM 分析失败：" + compact(err.Error(), 240)
		return out
	}
	var parsed struct {
		Summary string `json:"summary"`
		Risks   []struct {
			Title    string   `json:"title"`
			Detail   string   `json:"detail"`
			Evidence []string `json:"evidence"`
		} `json:"risks"`
		Focus []string `json:"focus"`
	}
	if err := json.Unmarshal([]byte(stripFence(body)), &parsed); err != nil {
		out.Status = "error"
		out.Summary = "LLM 返回的不是 JSON：" + compact(body, 2000)
		return out
	}
	out.Status = "ok"
	out.Summary = strings.TrimSpace(parsed.Summary)
	for _, risk := range parsed.Risks {
		out.Risks = append(out.Risks, model.AIRisk{
			Title:    strings.TrimSpace(risk.Title),
			Detail:   strings.TrimSpace(risk.Detail),
			Evidence: cleanList(risk.Evidence),
		})
	}
	out.Focus = cleanList(parsed.Focus)
	return out
}

func callResponses(ctx context.Context, cfg Config, prompt string) (string, error) {
	endpoint := strings.TrimRight(cfg.BaseURL, "/")
	if !strings.HasSuffix(endpoint, "/responses") {
		endpoint += "/responses"
	}
	payload := map[string]any{
		"model":             cfg.Model,
		"input":             prompt,
		"max_output_tokens": 12000,
	}
	raw, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(raw))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+cfg.APIKey)

	client := &http.Client{Timeout: cfg.Timeout}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if resp.StatusCode >= 300 {
		return "", fmt.Errorf("HTTP %d: %s", resp.StatusCode, compact(string(data), 300))
	}

	var envelope struct {
		Output []struct {
			Type    string `json:"type"`
			Content []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"content"`
		} `json:"output"`
		OutputText string `json:"output_text"`
		Error      any    `json:"error"`
	}
	if err := json.Unmarshal(data, &envelope); err != nil {
		return "", err
	}
	if envelope.Error != nil {
		return "", fmt.Errorf("upstream: %v", envelope.Error)
	}
	var parts []string
	for _, item := range envelope.Output {
		for _, content := range item.Content {
			if content.Type == "output_text" && content.Text != "" {
				parts = append(parts, content.Text)
			}
		}
	}
	if len(parts) == 0 && envelope.OutputText != "" {
		parts = append(parts, envelope.OutputText)
	}
	if len(parts) == 0 {
		return "", fmt.Errorf("响应没有 output_text: %s", compact(string(data), 500))
	}
	return strings.Join(parts, "\n"), nil
}

func buildPrompt(review *model.Review, files []contract.CodeFile) string {
	var b strings.Builder
	b.WriteString("你是代码评审助手。只根据下面给出的事实写中文结论，不要补造行号或调用关系。\n")
	b.WriteString("输出严格 JSON，不要 Markdown：\n")
	b.WriteString(`{"summary":"3-6 句中文概述","risks":[{"title":"风险标题","detail":"为什么","evidence":["证据字符串"]}],"focus":["建议优先看的点"]}`)
	b.WriteString("\n\n")
	fmt.Fprintf(&b, "改动：%s → %s\n", review.Before, review.After)
	fmt.Fprintf(&b, "统计：项目 +%d/-%d，逻辑 +%d/-%d，意图 +%d/-%d，行为 %d 节点 / %d 边 / %d 条行为\n",
		len(review.Project.Added), len(review.Project.Removed),
		len(review.Logic.Added), len(review.Logic.Removed),
		len(review.Intent.Added), len(review.Intent.Removed),
		review.Behavior.Stats.Nodes, review.Behavior.Stats.Edges, review.Behavior.Stats.Scenarios)

	if len(files) > 0 {
		b.WriteString("\n改动文件（最多 50 个）：\n")
		changed := changedFiles(files)
		for i, file := range changed {
			if i >= 50 {
				fmt.Fprintf(&b, "… 还有 %d 个文件\n", len(changed)-50)
				break
			}
			fmt.Fprintf(&b, "- %s [%s] +%d/-%d\n", file.Path, file.Status, lineCount(file.After), lineCount(file.Before))
		}
	}

	b.WriteString("\n意图事实（最多 20 条）：\n")
	writeFacts(&b, review.Intent.Added, review.Intent.Removed, 20)
	b.WriteString("\n行为 scenario（最多 20 条）：\n")
	for i, s := range review.Behavior.Scenarios {
		if i >= 20 {
			break
		}
		fmt.Fprintf(&b, "- [%s] %s（source=%s shape=%s）\n", s.Delta, s.Title, s.Source, s.Shape)
	}
	b.WriteString("\n关注点（最多 20 条）：\n")
	for i, s := range review.Signals {
		if i >= 20 {
			break
		}
		evidence := ""
		if len(s.Evidence) > 0 {
			evidence = s.Evidence[0]
		}
		fmt.Fprintf(&b, "- [%s] %s：%s（%s）\n", s.Severity, s.Title, s.Detail, evidence)
	}
	b.WriteString("\n要求：summary 先讲这次改动在语义上做了什么，再讲最值得复核的一点。risks 最多 5 条，focus 最多 5 条。evidence 只能引用上面的标题、路径或行号。\n")
	return b.String()
}

func writeFacts(b *strings.Builder, added, removed []model.Fact, limit int) {
	n := 0
	for _, f := range added {
		if n >= limit {
			return
		}
		fmt.Fprintf(b, "- [ADDED] %s（%s:%d，%s）\n", f.Title, f.File, f.Line, f.Shape)
		n++
	}
	for _, f := range removed {
		if n >= limit {
			return
		}
		fmt.Fprintf(b, "- [REMOVED] %s（%s:%d，%s）\n", f.Title, f.File, f.Line, f.Shape)
		n++
	}
}

func changedFiles(files []contract.CodeFile) []contract.CodeFile {
	out := make([]contract.CodeFile, 0, len(files))
	for _, f := range files {
		if f.Status != contract.CodeStatusUnchanged {
			out = append(out, f)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Path < out[j].Path })
	return out
}

func lineCount(s string) int {
	if s == "" {
		return 0
	}
	return strings.Count(s, "\n") + 1
}

func cleanList(in []string) []string {
	out := make([]string, 0, len(in))
	for _, s := range in {
		s = strings.TrimSpace(s)
		if s != "" {
			out = append(out, s)
		}
	}
	return out
}

func stripFence(s string) string {
	s = strings.TrimSpace(s)
	if strings.HasPrefix(s, "```") {
		if i := strings.Index(s, "\n"); i >= 0 {
			s = s[i+1:]
		}
		s = strings.TrimSuffix(strings.TrimSpace(s), "```")
	}
	// 模型偶尔会在 JSON 前后加一句解释。截取最外层大括号，避免整段丢弃。
	if start := strings.Index(s, "{"); start >= 0 {
		if end := strings.LastIndex(s, "}"); end > start {
			s = s[start : end+1]
		}
	}
	return strings.TrimSpace(s)
}

func compact(s string, n int) string {
	s = strings.ReplaceAll(strings.ReplaceAll(s, "\n", " "), "\t", " ")
	if len(s) > n {
		return s[:n] + "…"
	}
	return s
}
