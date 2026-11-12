import { describe, expect, it, beforeEach } from 'vitest';
import { loadExact, saveExact } from './exactPref';

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

describe('exact match preference', () => {
  it('falls back per surface: search off, symbols on', () => {
    expect(loadExact('search', false)).toBe(false);
    expect(loadExact('symbol', true)).toBe(true);
  });
  it('round-trips a saved value', () => {
    saveExact('search', true);
    expect(loadExact('search', false)).toBe(true);
    saveExact('search', false);
    expect(loadExact('search', true)).toBe(false);
  });
});
