#!/usr/bin/env node
/**
 * 生成前端开发用的 mock payload。
 *
 * 正式数据由 Go 的 /api/payload 提供；这个脚本只读取 demo 的 review.json
 * 和 before/after 源码，产出 public/mock/payload.json，方便 pnpm dev 独立跑。
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const frontend = path.resolve(here, '..');
const repo = path.resolve(frontend, '..');
const demo = path.join(repo, 'examples/demo-go');
const reviewPath = path.join(demo, 'out/review.json');
const output = path.join(frontend, 'public/mock/payload.json');

const SKIP_DIRS = new Set(['.git', 'node_modules', 'vendor', 'dist', 'out', 'bin']);
const MAX_FILE_BYTES = 512 * 1024;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;

const LANGUAGE = {
  '.go': 'go',
  '.mod': 'go',
  '.sum': 'text',
  '.md': 'markdown',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.css': 'css',
  '.html': 'html',
};

async function walk(root) {
  const out = new Map();
  async function visit(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(full);
      } else if (entry.isFile()) {
        const rel = path.relative(root, full).split(path.sep).join('/');
        const stat = await fs.stat(full).catch(() => null);
        if (!stat || stat.size > MAX_FILE_BYTES) continue;
        const buf = await fs.readFile(full).catch(() => null);
        if (!buf || buf.includes(0)) continue;
        out.set(rel, buf.toString('utf8'));
      }
    }
  }
  await visit(root);
  return out;
}

function statusOf(before, after) {
  if (before === undefined) return 'added';
  if (after === undefined) return 'removed';
  return before === after ? 'unchanged' : 'modified';
}

async function main() {
  const review = JSON.parse(await fs.readFile(reviewPath, 'utf8'));
  const before = await walk(path.join(demo, 'before'));
  const after = await walk(path.join(demo, 'after'));
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort();

  const files = [];
  let total = 0;
  for (const rel of paths) {
    const beforeText = before.get(rel);
    const afterText = after.get(rel);
    const size = (beforeText?.length ?? 0) + (afterText?.length ?? 0);
    if (total + size > MAX_TOTAL_BYTES) break;
    total += size;
    files.push({
      path: rel,
      status: statusOf(beforeText, afterText),
      language: LANGUAGE[path.extname(rel)] ?? 'text',
      ...(beforeText !== undefined ? { before: beforeText } : {}),
      ...(afterText !== undefined ? { after: afterText } : {}),
    });
  }

  const payload = {
    review,
    code: {
      root: 'examples/demo-go',
      files,
      ...(files.length < paths.length ? { truncated: true } : {}),
    },
  };

  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(payload, null, 2));
  console.log(`wrote ${path.relative(repo, output)} (${files.length} files)`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
