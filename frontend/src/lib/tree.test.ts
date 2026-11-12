import { describe, expect, it } from 'vitest';
import { buildTree, countFiles, countViewed, flattenTree } from './tree';
import type { CodeFile, CodeStatus } from '../types';

function file(path: string, status: CodeStatus = 'modified'): CodeFile {
  return { path, status, language: 'go', before: '', after: '' };
}

describe('sidebar order', () => {
  it('flattens to directories first, then names, at each level', () => {
    const files = [
      file('README.md'),
      file('cmd/main.go'),
      file('docs/a.md'),
      file('docs/sub/b.md'),
      file('cmd/x.go'),
    ];
    expect(flattenTree(buildTree(files, true))).toEqual([
      'cmd/main.go',
      'cmd/x.go',
      'docs/sub/b.md',
      'docs/a.md',
      'README.md',
    ]);
  });

  it('counts files and viewed files under a directory', () => {
    const tree = buildTree([file('docs/a.md'), file('docs/sub/b.md'), file('cmd/main.go')], true);
    const docs = tree.find((node) => node.path === 'docs');
    expect(docs && countFiles(docs)).toBe(2);
    expect(docs && countViewed(docs, (path) => path === 'docs/a.md')).toBe(1);
    expect(docs && countViewed(docs, () => true)).toBe(2);
  });

  it('ignores unchanged files when onlyChanged is set', () => {
    const files = [file('a.go'), file('b.go', 'unchanged')];
    expect(flattenTree(buildTree(files, true))).toEqual(['a.go']);
  });
});
