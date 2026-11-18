import { describe, expect, it } from 'vitest';
import { allDirs, autoExpanded, buildTree, countFiles, countViewed, dirAncestors, flattenTree } from './tree';
import type { CodeFile, CodeStatus } from '../types';

function file(path: string, status: CodeStatus = 'modified'): CodeFile {
  return { path, status, language: 'go', before: '', after: '' };
}

describe('default expansion', () => {
  const treeOf = (paths: string[]) => buildTree(paths.map((path) => file(path)), true);

  it('opens a single-directory chain down to the first level with files', () => {
    const tree = treeOf([
      'common/yak/reify/README.md',
      'common/yak/reify/reify.go',
      'common/yak/reify/cmd/reify/main.go',
      'common/yak/reify/core/engine.go',
    ]);
    expect([...autoExpanded(tree)].sort()).toEqual(['common', 'common/yak', 'common/yak/reify']);
  });

  it('leaves several top-level directories closed', () => {
    expect([...autoExpanded(treeOf(['cmd/main.go', 'docs/a.md', 'README.md']))]).toEqual([]);
  });

  it('opens a directory with direct files and leaves its branches closed', () => {
    expect([...autoExpanded(treeOf(['src/main.go', 'src/lib/a.go']))]).toEqual(['src']);
  });

  it('stays closed at a branch point without files', () => {
    expect([...autoExpanded(treeOf(['src/a/one.go', 'src/b/two.go']))]).toEqual([]);
  });

  it('expands nothing when there are no files', () => {
    expect(autoExpanded([])).toEqual(new Set<string>());
  });
});

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

  it('lists ancestor directories shallowest first', () => {
    expect(dirAncestors('a/b/c.go')).toEqual(['a', 'a/b']);
    expect(dirAncestors('main.go')).toEqual([]);
  });
  it('collects every directory for expand-all', () => {
    const tree = buildTree([
      { path: 'a/b/one.go', status: 'added', language: 'go', before: '', after: 'x' },
      { path: 'a/two.go', status: 'modified', language: 'go', before: 'x', after: 'y' },
      { path: 'c.go', status: 'added', language: 'go', before: '', after: 'z' },
    ], true);
    expect([...allDirs(tree)].sort()).toEqual(['a', 'a/b']);
  });
});
