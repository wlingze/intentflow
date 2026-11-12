import { describe, expect, it } from 'vitest';
import { fileRowTone } from './tree';

describe('fileRowTone', () => {
  const onScreen = ['a.go', 'b.go'];

  it('marks the opened file active', () => {
    expect(fileRowTone('a.go', 'a.go', onScreen)).toBe('active');
  });

  it('greys the other files on screen', () => {
    expect(fileRowTone('b.go', 'a.go', onScreen)).toBe('onScreen');
  });

  it('leaves files that are not on screen alone', () => {
    expect(fileRowTone('c.go', 'a.go', onScreen)).toBe('');
  });

  it('has no tone without an active file', () => {
    expect(fileRowTone('a.go', '', onScreen)).toBe('onScreen');
    expect(fileRowTone('c.go', '', onScreen)).toBe('');
  });
});
