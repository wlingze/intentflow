import { beforeEach, describe, expect, it } from 'vitest';
import { buildTree, type TreeNode } from './tree';
import { initialExpanded, loadTreeOpen, saveTreeOpen, toggleDir } from './treeExpand';
import type { CodeFile } from '../types';

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  globalThis.localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as Storage;
});

function treeOf(paths: string[]): TreeNode[] {
  const files: CodeFile[] = paths.map((path) => ({ path, status: 'modified', language: 'go', before: '', after: '' }));
  return buildTree(files, true);
}

const chain = ['common/yak/reify/README.md', 'common/yak/reify/cmd/reify/main.go'];

describe('tree expansion preference', () => {
  it('uses the default rule when the comparison has no stored choice', () => {
    expect([...initialExpanded('cmp', treeOf(chain))].sort()).toEqual(['common', 'common/yak', 'common/yak/reify']);
  });

  it('restores the manual choice over the default rule', () => {
    saveTreeOpen('cmp', ['common/yak/reify/cmd']);
    expect([...initialExpanded('cmp', treeOf(chain))]).toEqual(['common/yak/reify/cmd']);
  });

  it('keeps the choice per comparison', () => {
    saveTreeOpen('cmp-a', ['common']);
    expect(loadTreeOpen('cmp-b')).toBeNull();
    expect([...initialExpanded('cmp-b', treeOf(chain))].sort()).toEqual(['common', 'common/yak', 'common/yak/reify']);
  });

  it('saves a manual collapse', () => {
    const open = toggleDir(initialExpanded('cmp', treeOf(chain)), 'common', false);
    saveTreeOpen('cmp', open);
    expect(loadTreeOpen('cmp')).toEqual(new Set(['common/yak', 'common/yak/reify']));
  });

  it('returns the same set when a toggle changes nothing', () => {
    const open = new Set(['common']);
    expect(toggleDir(open, 'common', true)).toBe(open);
  });

  it('falls back to the default rule on a broken entry', () => {
    store.set('intentflow.tree-open.cmp', '{');
    expect(loadTreeOpen('cmp')).toBeNull();
    expect([...initialExpanded('cmp', treeOf(chain))].sort()).toEqual(['common', 'common/yak', 'common/yak/reify']);
  });

  it('does not store without a comparison id', () => {
    saveTreeOpen('', ['common']);
    expect(store.size).toBe(0);
    expect(loadTreeOpen('')).toBeNull();
  });
});