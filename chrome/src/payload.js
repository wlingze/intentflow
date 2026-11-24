// Build the same contract payload the Go exporter writes. The frontend only
// needs api/payload.json and api/revisions.json, so the userscript supplies
// those two documents from the parsed patch.

const MAX_TOTAL_BYTES = 24 * 1024 * 1024;

const LANGUAGES = {
  '.go': 'go', '.mod': 'go', '.sum': 'text', '.ts': 'typescript', '.tsx': 'tsx',
  '.js': 'javascript', '.jsx': 'jsx', '.mjs': 'javascript', '.cjs': 'javascript',
  '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml', '.md': 'markdown',
  '.css': 'css', '.scss': 'scss', '.html': 'html', '.py': 'python', '.rs': 'rust',
  '.java': 'java', '.kt': 'kotlin', '.c': 'c', '.h': 'c', '.cc': 'cpp', '.cpp': 'cpp',
  '.cxx': 'cpp', '.hpp': 'cpp', '.cs': 'csharp', '.sh': 'shell', '.bash': 'shell',
  '.zsh': 'shell', '.sql': 'sql', '.swift': 'swift', '.rb': 'ruby', '.php': 'php',
  '.scala': 'scala', '.lua': 'lua', '.cmake': 'cmake', '.gradle': 'groovy',
  '.kts': 'kotlin', '.tf': 'hcl', '.tfvars': 'hcl', '.mk': 'makefile',
  '.proto': 'protobuf', '.txt': 'text', '.xml': 'xml', '.docker': 'docker',
};

function languageOf(path) {
  const base = path.split('/').pop().toLowerCase();
  if (base === 'dockerfile') return 'docker';
  if (base === 'makefile') return 'makefile';
  if (base === 'cmakelists.txt') return 'cmake';
  const dot = base.lastIndexOf('.');
  const ext = dot >= 0 ? base.slice(dot) : '';
  return LANGUAGES[ext] ?? (ext ? ext.slice(1) : 'text');
}

function allocate(sizes, max) {
  const order = sizes.map((_, index) => index).sort((a, b) => sizes[a] - sizes[b] || a - b);
  const keep = new Array(sizes.length).fill(false);
  let total = 0;
  for (const index of order) {
    if (total + sizes[index] > max) continue;
    keep[index] = true;
    total += sizes[index];
  }
  return keep;
}

function codeBundle(files, label) {
  const sizes = files.map((file) => file.before.length + file.after.length);
  const keep = allocate(sizes, MAX_TOTAL_BYTES);
  const out = { files: [], root: label, skipped: [], truncated: false };
  files.forEach((file, index) => {
    const code = {
      after: keep[index] ? file.after : '',
      before: keep[index] ? file.before : '',
      language: file.binary ? 'binary' : languageOf(file.path),
      ...(file.oldPath ? { old_path: file.oldPath } : {}),
      path: file.path,
      status: file.status,
    };
    if (!keep[index]) {
      out.truncated = true;
      out.skipped.push(file.path);
    }
    out.files.push(code);
  });
  return out;
}

function goJSON(value) {
  // encoding/json escapes HTML-sensitive characters; match it so a userscript
  // session keeps the same ids as the Go exporter.
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (ch) => ({
    '<': '\\u003c', '>': '\\u003e', '&': '\\u0026', '\u2028': '\\u2028', '\u2029': '\\u2029',
  }[ch]));
}

async function sha256(value) {
  const data = new TextEncoder().encode(goJSON(value));
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function reviewContext(repository, branch, base, head, code) {
  const diffDigest = await sha256(code.files);
  const sessionId = (await sha256([repository, branch, ''])).slice(0, 24);
  const ctx = {
    base,
    branch,
    comparison_id: '',
    diff_digest: diffDigest,
    head,
    repository,
    revision: 'range',
    session_id: sessionId,
    subdir: '',
  };
  ctx.comparison_id = (await sha256(ctx)).slice(0, 24);
  return ctx;
}

function emptyReview(before, after, comparison) {
  return {
    after,
    ai: { focus: [], generated_at: '', model: '', modules: [], risks: [], status: 'unavailable', summary: '' },
    baseBehind: 0,
    baseLabel: '',
    baseUpstream: '',
    before,
    behavior: {
      edges: [], entry: '', lanes: [], nodes: [], scenarios: [], stageCount: 0,
      stats: { added: 0, edges: 0, modified: 0, nodes: 0, removed: 0, scenarios: 0 },
    },
    comparison,
    findings: [],
    intent: { added: [], removed: [] },
    logic: { added: [], removed: [] },
    needsRebase: false,
    notes: [],
    project: { added: [], removed: [] },
    scan: { files: 0, findings: 0, finished_at: '', message: '', mode: 'diff', rules: 0, started_at: '', status: 'skipped' },
    signals: [],
    symbols: {
      edges: [], nodes: [], unresolved: [],
      stats: { calls: 0, functions: 0, types: 0, unresolved: 0 },
    },
  };
}

export async function buildPayload(files, meta) {
  const before = meta.before || '补丁前';
  const after = meta.after || '补丁后';
  const repository = meta.repository || 'patch';
  const branch = meta.branch || 'patch';
  const title = meta.title || `${files.length} 个文件`;
  const label = `${before} → ${after}`;
  const code = codeBundle(files, label);
  const context = await reviewContext(repository, branch, before, after, code);
  const note = meta.note || 'GitHub PR：diff 由浏览器脚本在本地解析；展开的未改区间是空占位行。';
  const comparison = {
    afterLabel: after,
    ...(meta.baseRef ? { baseRef: meta.baseRef } : {}),
    beforeLabel: before,
    commits: [],
    ...(meta.headRef ? { headRef: meta.headRef } : {}),
    mode: 'git',
    note,
    ...(repository !== 'patch' ? { repo: repository } : {}),
    selected: [],
  };
  const review = emptyReview(before, after, comparison);
  review.notes = [note];
  const revisions = {
    base: before,
    current: 'range',
    dirty: false,
    head: after,
    revisions: [{ author: '', date: '', files: files.length, id: 'range', kind: 'range', label: '补丁', sha: '', short: '', subject: title }],
  };
  return {
    payload: {
      code,
      review,
      session: { comments: [], context, reviewed_hunks: [], updated_at: '', version: 1, viewed: [] },
    },
    revisions,
  };
}

export function commentBody(comment) {
  const text = String(comment.text ?? '').trim();
  const title = String(comment.title ?? '').trim();
  if (!title) return text;
  return text ? `**${title}**\n\n${text}` : title;
}

export { languageOf };
