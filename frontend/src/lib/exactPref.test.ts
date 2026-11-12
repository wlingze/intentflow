import { beforeEach, describe, expect, it } from 'vitest';
import { loadMatch, saveMatch } from './exactPref';

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

describe('match preferences', () => {
  it('defaults: search loose, symbols exact', () => {
    expect(loadMatch('search')).toEqual({ caseSensitive: false, wholeWord: false });
    expect(loadMatch('symbol')).toEqual({ caseSensitive: true, wholeWord: true });
  });
  it('round-trips the two flags independently', () => {
    saveMatch('search', { caseSensitive: true, wholeWord: false });
    expect(loadMatch('search')).toEqual({ caseSensitive: true, wholeWord: false });
  });
  it('migrates the old combined exact flag', () => {
    store.set('intentflow.symbol-exact', '0');
    expect(loadMatch('symbol')).toEqual({ caseSensitive: false, wholeWord: false });
  });
});
