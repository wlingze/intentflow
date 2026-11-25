import { buildPayload } from './payload.js';
import { fetchComments, fetchDiff, fetchPull, importComments, mapReview, submitReview } from './github.js';
import { parsePatch } from './patch.js';

async function loadPr({ owner, repo, number }) {
  const [diff, pull, comments] = await Promise.all([
    fetchDiff(owner, repo, number), fetchPull(owner, repo, number), fetchComments(owner, repo, number),
  ]);
  if (!diff.trim()) throw new Error('PR diff 为空');
  const built = await buildPayload(parsePatch(diff).files, {
    repository: `github.com/${owner}/${repo}`, branch: `pull/${number}`,
    before: pull.base?.ref || 'base', after: pull.head?.ref || 'head',
    baseRef: pull.base?.sha, headRef: pull.head?.sha,
    title: pull.title || document.title.split(' · ')[0] || `PR #${number}`,
    note: `GitHub PR #${number}：diff 由浏览器脚本在本地解析；展开的未改区间是空占位行。`,
  });
  const imported = importComments(comments);
  built.payload.session.comments = imported;
  if (imported.length) built.payload.review.notes.push(`已导入 ${imported.length} 条 GitHub review 评论。`);
  return built;
}

export function createPrSource(pr) {
  // 两个读取方法共用本次打开的快照。关闭后重新打开才重新取 PR。
  let snapshot;
  const load = () => snapshot ??= loadPr(pr);
  return {
    publishLabel: 'GitHub',
    fetchPayload: async () => (await load()).payload,
    fetchRevisions: async () => (await load()).revisions,
    // 提交前重新抓 diff：打开的这段时间里 PR 可能已经变了。
    publishReview: async (document, event) => {
      const diff = await fetchDiff(pr.owner, pr.repo, pr.number);
      const review = mapReview(document, diff);
      const result = await submitReview(pr.owner, pr.repo, pr.number, { ...review, event });
      const skipped = review.skipped ? `，${review.skipped} 条未映射进 review 正文` : '';
      return `已提交评论：${result.comments} 条行内评论${skipped}`;
    },
  };
}
