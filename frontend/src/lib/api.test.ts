import { describe, expect, it } from 'vitest';
import { apiPath } from './api';

describe('apiPath', () => {
  it('stays relative so static and PR-prefixed pages share one client', () => {
    expect(apiPath('payload.json')).toBe('api/payload.json');
    expect(apiPath('revisions.json')).toBe('api/revisions.json');
  });
});
