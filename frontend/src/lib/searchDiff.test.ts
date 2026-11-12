import { describe, expect, it } from 'vitest';
import type { CodeFile } from '../types';
import { searchDiff } from './searchDiff';

const file: CodeFile = {
  path: 'src/demo.ts', status: 'modified', language: 'typescript',
  before: 'const keep = 1;\nconst oldName = 2;\nconst end = 3;\n',
  after: 'const keep = 1;\nconst newName = 2;\nconst end = 3;\n',
};

describe('global diff search', () => {
  it('finds added lines on the after side', () => {
    const [hit] = searchDiff([file], 'newName');
    expect(hit).toMatchObject({ path: 'src/demo.ts', side: 'after', line: 2, kind: 'add' });
  });
  it('finds deleted lines on the before side', () => {
    const [hit] = searchDiff([file], 'oldName');
    expect(hit).toMatchObject({ side: 'before', line: 2, kind: 'del' });
  });
  it('finds context once and ignores empty queries', () => {
    expect(searchDiff([file], 'keep')).toHaveLength(1);
    expect(searchDiff([file], 'keep')[0]).toMatchObject({ side: 'after', line: 1, kind: 'equal' });
    expect(searchDiff([file], '   ')).toEqual([]);
  });
  it('is case-insensitive and keeps file order', () => {
    const other = { ...file, path: 'src/other.ts' };
    expect(searchDiff([file, other], 'NEWNAME').map((hit) => hit.path)).toEqual(['src/demo.ts', 'src/other.ts']);
  });

  it('matches whole words only in exact mode', () => {
    expect(searchDiff([file], 'name', { wholeWord: true })).toEqual([]);
    expect(searchDiff([file], 'newName', { wholeWord: true })).toHaveLength(1);
    expect(searchDiff([file], 'newname', { wholeWord: true, caseSensitive: true })).toEqual([]);
    expect(searchDiff([file], 'newname', { wholeWord: true })).toHaveLength(1);
    expect(searchDiff([file], 'newname')).toHaveLength(1);
  });
  it('keeps punctuation and operator queries exact', () => {
    const ops: CodeFile = { ...file, before: 'a := 1\nb := 2\n', after: 'a := 1\nb == 2\n' };
    expect(searchDiff([ops], ':=', { wholeWord: true })).toHaveLength(2);
    expect(searchDiff([ops], ':=', { wholeWord: true }).map((hit) => hit.line)).toEqual([1, 2]);
    expect(searchDiff([ops], '= ', { wholeWord: true })).toHaveLength(0);
  });
});
