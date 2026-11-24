// Pure-JS unified diff parser. Mirrors internal/patch: keep each hunk at its
// absolute line number and fill unchanged gaps with empty placeholder lines.

function isNullPath(path) {
  return path === '/dev/null' || path === 'dev/null';
}

function stripPrefix(path) {
  if (isNullPath(path)) return '';
  return path.startsWith('a/') || path.startsWith('b/') ? path.slice(2) : path;
}

function unquoteGitPath(raw) {
  if (!raw.startsWith('"')) return raw;
  let escaped = false;
  for (let i = 1; i < raw.length; i += 1) {
    if (escaped) { escaped = false; continue; }
    if (raw[i] === '\\') { escaped = true; continue; }
    if (raw[i] !== '"') continue;
    const body = raw.slice(1, i);
    return body.replace(/\\([0-7]{1,3}|.)/g, (_, ch) => {
      if (/^[0-7]+$/.test(ch)) return String.fromCharCode(parseInt(ch, 8));
      switch (ch) {
        case 'n': return '\n';
        case 't': return '\t';
        case 'r': return '\r';
        case 'b': return '\b';
        case 'f': return '\f';
        case 'v': return '\v';
        case '\\': return '\\';
        case '"': return '"';
        default: return ch;
      }
    });
  }
  return raw;
}

function takeToken(input) {
  const text = input.replace(/^ +/, '');
  if (!text) return null;
  if (text.startsWith('"')) {
    let escaped = false;
    for (let i = 1; i < text.length; i += 1) {
      if (escaped) { escaped = false; continue; }
      if (text[i] === '\\') { escaped = true; continue; }
      if (text[i] === '"') {
        return { token: unquoteGitPath(text.slice(0, i + 1)), rest: text.slice(i + 1) };
      }
    }
    return null;
  }
  const space = text.indexOf(' ');
  if (space < 0) return { token: text, rest: '' };
  return { token: text.slice(0, space), rest: text.slice(space + 1) };
}

function splitGitHeader(rest) {
  const first = takeToken(rest);
  if (!first) return null;
  const second = takeToken(first.rest);
  if (!second) return null;
  return { oldPath: stripPrefix(first.token), newPath: stripPrefix(second.token) };
}

function headerPath(raw) {
  const text = raw.trim();
  let path = text;
  if (text.startsWith('"')) {
    const token = takeToken(text);
    if (token) path = token.token;
  } else {
    const tab = path.indexOf('\t');
    if (tab >= 0) path = path.slice(0, tab);
  }
  return { path: isNullPath(path) ? '' : stripPrefix(path), nullPath: isNullPath(path) };
}

function parseRange(field, sign) {
  if (!field || field[0] !== sign) return null;
  const body = field.slice(1);
  const comma = body.indexOf(',');
  let start = body, count = 1;
  if (comma >= 0) {
    start = body.slice(0, comma);
    count = Number(body.slice(comma + 1));
    if (!Number.isInteger(count) || count < 0) return null;
  }
  const value = Number(start);
  if (!Number.isInteger(value) || value < 0) return null;
  return { start: value, count };
}

function parseHunkHeader(line) {
  const match = /^@@ -(\d+(?:,\d+)?) \+(\d+(?:,\d+)?) @@(.*)$/.exec(line);
  if (!match) throw new Error(`无法解析 hunk 头: ${line}`);
  const oldRange = parseRange('-' + match[1], '-');
  const newRange = parseRange('+' + match[2], '+');
  if (!oldRange || !newRange) throw new Error(`无法解析 hunk 头: ${line}`);
  return {
    oldStart: oldRange.start, oldLines: oldRange.count,
    newStart: newRange.start, newLines: newRange.count,
    section: match[3].trim(), lines: [],
  };
}

function validateHunk(hunk) {
  let oldCount = 0, newCount = 0;
  for (const line of hunk.lines) {
    if (line.kind === ' ') { oldCount += 1; newCount += 1; }
    else if (line.kind === '-') oldCount += 1;
    else if (line.kind === '+') newCount += 1;
    else throw new Error(`hunk 含未知行类型 ${line.kind}`);
  }
  if (oldCount !== hunk.oldLines || newCount !== hunk.newLines) {
    throw new Error(`hunk @@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@ 声明行数与内容不一致`);
  }
}

function reconstruct(hunks) {
  const oldLines = [];
  const newLines = [];
  for (const hunk of hunks) {
    validateHunk(hunk);
    if (hunk.oldStart > 0) while (oldLines.length < hunk.oldStart - 1) oldLines.push('');
    if (hunk.newStart > 0) while (newLines.length < hunk.newStart - 1) newLines.push('');
    for (const line of hunk.lines) {
      if (line.kind === ' ') { oldLines.push(line.text); newLines.push(line.text); }
      else if (line.kind === '-') oldLines.push(line.text);
      else if (line.kind === '+') newLines.push(line.text);
    }
  }
  return { before: oldLines.join('\n'), after: newLines.join('\n') };
}

function finishFile(builder, out) {
  if (!builder) return;
  let status = 'modified';
  if (builder.deletedFile || builder.newNull || (builder.newPath === '' && builder.oldPath !== '')) status = 'removed';
  else if (builder.newFile || builder.oldNull || (builder.oldPath === '' && builder.newPath !== '')) status = 'added';
  else if (builder.renamed || (builder.oldPath && builder.newPath && builder.oldPath !== builder.newPath)) status = 'renamed';
  const path = builder.newPath || builder.oldPath;
  if (!path || isNullPath(path)) return;
  const file = {
    path, oldPath: status === 'renamed' && builder.oldPath !== path ? builder.oldPath : '',
    status, binary: builder.binary, hunks: builder.hunks.slice(), before: '', after: '',
  };
  if (!builder.binary) {
    const text = reconstruct(builder.hunks);
    file.before = status === 'added' ? '' : text.before;
    file.after = status === 'removed' ? '' : text.after;
  }
  out.push(file);
}

function applyHunks(base, hunks) {
  let lines = base === '' ? [] : base.split('\n');
  let offset = 0;
  for (const hunk of hunks) {
    validateHunk(hunk);
    let start = hunk.oldStart - 1 + offset;
    if (hunk.oldStart === 0) start = offset;
    if (start < 0) start = 0;
    while (lines.length < start) lines.push('');
    const end = start + hunk.oldLines;
    while (lines.length < end) lines.push('');
    const block = [];
    for (const line of hunk.lines) if (line.kind === ' ' || line.kind === '+') block.push(line.text);
    lines = [...lines.slice(0, start), ...block, ...lines.slice(end)];
    offset += hunk.newLines - hunk.oldLines;
  }
  return lines.join('\n');
}

function mergeFiles(raw) {
  const byPath = new Map();
  for (const file of raw) {
    let state = file.status !== 'added' ? byPath.get(file.oldPath) : undefined;
    if (!state) state = byPath.get(file.path);
    if (!state) {
      byPath.set(file.path, { ...file, hunks: file.hunks.slice() });
      continue;
    }
    if (file.status === 'added' && state.status === 'removed') {
      const next = { ...file, hunks: file.hunks.slice() };
      byPath.set(file.path, next);
      continue;
    }
    state.after = applyHunks(state.after, file.hunks);
    if (file.status === 'renamed' && state.status !== 'added' && state.status !== 'removed') {
      state.oldPath = file.oldPath;
      state.status = 'renamed';
    }
    if (file.status === 'removed') {
      state.status = 'removed';
      state.after = '';
    }
    if (state.path !== file.path) {
      byPath.delete(state.path);
      state.path = file.path;
      byPath.set(state.path, state);
    }
  }
  const files = [...byPath.values()];
  for (const file of files) {
    if (file.status === 'added') file.before = '';
    if (file.status === 'removed') file.after = '';
  }
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export function parsePatch(data) {
  const text = String(data).replace(/\r\n/g, '\n');
  if (!text.trim()) throw new Error('补丁里没有 diff');
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();

  const raw = [];
  const subjects = [];
  let current = null;
  let hunk = null;
  let oldLeft = 0;
  let newLeft = 0;

  const ensureCurrent = () => {
    if (!current) current = { oldPath: '', newPath: '', oldNull: false, newNull: false, newFile: false, deletedFile: false, renamed: false, binary: false, gitHeader: false, hunks: [] };
    return current;
  };
  const resetHunk = () => { hunk = null; oldLeft = 0; newLeft = 0; };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (hunk && (oldLeft > 0 || newLeft > 0)) {
      if (line === '\\ No newline at end of file') continue;
      const kind = line === '' ? ' ' : line[0];
      const body = line === '' ? '' : line.slice(1);
      if (kind === ' ') {
        if (oldLeft === 0 || newLeft === 0) throw new Error('hunk 含有超出声明行数的上下文行');
        hunk.lines.push({ kind, text: body }); oldLeft -= 1; newLeft -= 1;
      } else if (kind === '-') {
        if (oldLeft === 0) throw new Error('hunk 含有超出声明行数的删除行');
        hunk.lines.push({ kind, text: body }); oldLeft -= 1;
      } else if (kind === '+') {
        if (newLeft === 0) throw new Error('hunk 含有超出声明行数的添加行');
        hunk.lines.push({ kind, text: body }); newLeft -= 1;
      } else {
        throw new Error(`hunk 中出现无法识别的行 ${JSON.stringify(line)}`);
      }
      if (oldLeft === 0 && newLeft === 0) hunk = null;
      continue;
    }

    if (line.startsWith('Subject:')) {
      let subject = line.slice('Subject:'.length).trim();
      if (subject.startsWith('[PATCH')) {
        const close = subject.indexOf(']');
        if (close >= 0) subject = subject.slice(close + 1).trim();
      }
      if (subject) subjects.push(subject);
      continue;
    }
    if (line.startsWith('diff --git ')) {
      finishFile(current, raw); current = null; resetHunk();
      const paths = splitGitHeader(line.slice('diff --git '.length));
      if (!paths) throw new Error(`无法解析 diff --git 路径: ${line}`);
      current = { oldPath: paths.oldPath, newPath: paths.newPath, oldNull: false, newNull: false, newFile: false, deletedFile: false, renamed: false, binary: false, gitHeader: true, hunks: [] };
      continue;
    }
    if (line.startsWith('--- ')) {
      // A commit message may contain "--- note". Only accept it when a +++
      // line follows before the next diff.
      let next = '';
      for (let probe = index + 1; probe < lines.length; probe += 1) {
        if (lines[probe].startsWith('diff --git ') || lines[probe].startsWith('@@ ')) break;
        if (lines[probe].startsWith('+++ ')) { next = lines[probe]; break; }
      }
      if (!next) continue;
      if (!current || (!current.gitHeader && (current.oldPath || current.newPath || current.hunks.length))) {
        finishFile(current, raw); current = null; resetHunk();
      }
      const parsed = headerPath(line.slice(4));
      current = ensureCurrent();
      current.oldPath = parsed.path; current.oldNull = parsed.nullPath;
      continue;
    }
    if (line.startsWith('+++ ')) {
      const parsed = headerPath(line.slice(4));
      current = ensureCurrent();
      current.newPath = parsed.path; current.newNull = parsed.nullPath;
      continue;
    }
    if (line.startsWith('@@ ')) {
      current = ensureCurrent();
      const nextHunk = parseHunkHeader(line);
      current.hunks.push(nextHunk);
      hunk = nextHunk; oldLeft = nextHunk.oldLines; newLeft = nextHunk.newLines;
      if (oldLeft === 0 && newLeft === 0) hunk = null;
      continue;
    }
    if (line.startsWith('new file mode ') || line === 'new file mode') { ensureCurrent().newFile = true; continue; }
    if (line.startsWith('deleted file mode ') || line === 'deleted file mode') { ensureCurrent().deletedFile = true; continue; }
    if (line.startsWith('rename from ')) { ensureCurrent().renamed = true; current.oldPath = line.slice('rename from '.length).trim(); continue; }
    if (line.startsWith('rename to ')) { ensureCurrent().renamed = true; current.newPath = line.slice('rename to '.length).trim(); continue; }
    if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) { ensureCurrent().binary = true; continue; }
    // index/old mode/new mode/From/Date/MIME headers are intentionally ignored.
  }

  if (hunk && (oldLeft > 0 || newLeft > 0)) throw new Error('补丁在 hunk 中间结束');
  finishFile(current, raw);
  if (raw.length === 0) throw new Error('补丁里没有 diff');
  return { files: mergeFiles(raw), subjects };
}

// GitHub review comments address old-side lines with LEFT and new-side lines
// with RIGHT. A line is addressable only inside a hunk on that side.
export function indexPatch(files) {
  const out = new Map();
  for (const file of files) {
    const oldRanges = [];
    const newRanges = [];
    for (const hunk of file.hunks) {
      if (hunk.oldLines > 0) oldRanges.push({ start: hunk.oldStart, end: hunk.oldStart + hunk.oldLines - 1 });
      if (hunk.newLines > 0) newRanges.push({ start: hunk.newStart, end: hunk.newStart + hunk.newLines - 1 });
    }
    out.set(file.path, { old: oldRanges, new: newRanges });
  }
  return out;
}
