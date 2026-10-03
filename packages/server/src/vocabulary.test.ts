import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Character } from '@theatre/core';

const { unknownWords } = vi.hoisted(() => ({
  unknownWords: vi.fn(async (words: string[]) => new Set(words.filter((w) => w === 'chévéloure'))),
}));
vi.mock('./spell', () => ({ unknownWords, spellCheckAvailable: () => true }));

const { vocabularyFor } = await import('./vocabulary');

const cast: Character[] = [{ id: 'zoe', canonicalName: 'ZOÉ', aliases: ['ZOÉ'] }];
const fountain = (line: string) => `Title: Test\n\n.ACTE I.\n\n@ZOÉ\n${line}\n`;

beforeEach(() => {
  unknownWords.mockClear();
});

describe('vocabularyFor', () => {
  it('lists character names first, then words the spell checker rejects', async () => {
    const vocab = await vocabularyFor(fountain('Quelle chévéloure magnifique.'), cast);
    expect(vocab[0]).toBe('Zoé');
    expect(vocab).toContain('chévéloure');
    expect(vocab).not.toContain('magnifique');
  });

  it('memoises per content and recomputes when the text changes', async () => {
    const text = fountain('Ma chévéloure brille.');
    const first = await vocabularyFor(text, cast);
    const calls = unknownWords.mock.calls.length;
    expect(await vocabularyFor(text, cast)).toBe(first);
    expect(unknownWords.mock.calls.length).toBe(calls);

    await vocabularyFor(fountain('Ma chévéloure brille encore.'), cast);
    expect(unknownWords.mock.calls.length).toBe(calls + 1);
  });
});
