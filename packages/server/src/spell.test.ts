import { afterEach, describe, expect, it } from 'vitest';
import { spellCheckAvailable, unknownWords } from './spell';

afterEach(() => {
  delete process.env.THEATRE_DISABLE_SPELLCHECK;
});

describe('unknownWords', () => {
  it.skipIf(process.platform !== 'darwin')('flags invented words and accepts real ones', async () => {
    const unknown = await unknownWords(['chévéloure', 'chevelure']);
    expect(unknown.has('chévéloure')).toBe(true);
    expect(unknown.has('chevelure')).toBe(false);
    expect(spellCheckAvailable()).toBe(true);
  }, 60_000);

  it('resolves to an empty set without throwing when the checker cannot run', async () => {
    process.env.THEATRE_DISABLE_SPELLCHECK = '1';
    await expect(unknownWords(['chévéloure'])).resolves.toEqual(new Set());
    expect(spellCheckAvailable()).toBe(false);
  });
});
