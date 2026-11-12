import { describe, expect, it } from 'vitest';
import { clearCodeSelection, codeSelection, setCodeSelection } from './codeSelection';

describe('code selection cache', () => {
  it('stores the last picked text for search prefill', () => {
    setCodeSelection('func main()');
    expect(codeSelection()).toBe('func main()');
    clearCodeSelection();
    expect(codeSelection()).toBe('');
  });
});
