import { describe, expect, it } from 'vitest';
import { buildReviewMarkdown } from './markdown';
import type { Comment, Finding, Review, ReviewSession } from '../types';

// buildReviewMarkdown 只读 review.before / review.after / review.notes，
// 其余字段与导出无关，这里用一个只含这三项的对象代替完整 Review。
const review = (notes: string[] = []): Review => ({ before: 'main', after: 'HEAD', notes } as unknown as Review);

const context = {
  session_id: 'session-a', comparison_id: 'range-a', repository: '/repo/intentflow', branch: 'feature/export',
  base: '111111111111aaaa', head: '222222222222bbbb', revision: 'range', subdir: '', diff_digest: 'd',
};

const lineComment: Comment = {
  id: 'c-1', text: '用户输入直接拼进了 SQL。改成参数化查询。', title: 'SQL 注入',
  source: 'manual', signalId: '', createdAt: 1, resolved: false,
  quote: { file: 'internal/store/store.go', side: 'after', start: 15, end: 17, snippet: 'query := "SELECT * FROM users WHERE name = \'%s\'"\nrows, err := db.Query(query)' },
};

const doc = (comments: Comment[], reviewedHunks: string[] = []): ReviewSession => ({
  version: 1, context, comments, viewed: [], reviewed_hunks: reviewedHunks, updated_at: '',
});

describe('review markdown export', () => {
  it('numbers comments, quotes the snippet and names the scope', () => {
    const md = buildReviewMarkdown(review(), doc([
      lineComment,
      { id: 'c-2', text: '这次改动建议整体退回。', title: '', source: 'manual', signalId: '', createdAt: 2, resolved: true },
    ]));

    expect(md.split('\n')[0]).toBe('# Review: main → HEAD');
    expect(md).toContain('仓库：/repo/intentflow');
    expect(md).toContain('比较：range · 111111111111 → 222222222222');

    expect(md).toContain('### 1. internal/store/store.go:15-17 · 改动后');
    expect(md).toContain('> query := "SELECT * FROM users WHERE name = \'%s\'"\n> rows, err := db.Query(query)');
    expect(md).toContain('**SQL 注入**');
    expect(md).toContain('用户输入直接拼进了 SQL。改成参数化查询。');

    expect(md).toContain('### 2. 整体意见（已解决）');
    expect(md).toContain('这次改动建议整体退回。');
    expect(md.indexOf('### 1.')).toBeLessThan(md.indexOf('### 2.'));
    expect(md.endsWith('\n')).toBe(true);
  });

  it('writes the empty marker, findings and notes sections', () => {
    const findings: Finding[] = [{
      category: 'security', category_title: '安全', engine: 'rules', file: 'internal/store/store.go',
      id: 'f-1', line: 15, rule: 'sql.concat', severity: 'high',
      snippet: 'db.Query(query)', title: 'SQL 拼接',
    }];

    const md = buildReviewMarkdown(review(['服务未启动时，导出仍在浏览器内完成。']), doc([]), findings);

    expect(md).toContain('## Review 意见\n\n（暂无评论）');
    expect(md).toContain('## 重点位置');
    expect(md).toContain('- [安全] SQL 拼接 — internal/store/store.go:15');
    expect(md).toContain('  - `db.Query(query)`');
    expect(md).toContain('## 运行说明');
    expect(md).toContain('- 服务未启动时，导出仍在浏览器内完成。');
    expect(md).not.toContain('###');
  });
});