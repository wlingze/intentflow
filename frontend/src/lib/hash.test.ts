import { describe, expect, it } from 'vitest';
import { fileDigest, hashText } from './hash';

describe('review digests', () => {
  it('is stable for the same content', () => {
    expect(hashText('a\nb')).toBe(hashText('a\nb'));
    expect(fileDigest('a.go', 'old', 'new')).toBe(fileDigest('a.go', 'old', 'new'));
  });
  it('changes when the reviewed content changes', () => {
    expect(fileDigest('a.go', 'old', 'new')).not.toBe(fileDigest('a.go', 'old', 'newer'));
    expect(fileDigest('a.go', 'old', 'new')).not.toBe(fileDigest('b.go', 'old', 'new'));
  });
});
