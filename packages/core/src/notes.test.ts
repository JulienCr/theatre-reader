import { describe, expect, it } from 'vitest';
import { resolveNote } from './notes';

describe('resolveNote', () => {
  const text = 'MICHEL : Bonjour à tous.';
  it('résout quand la citation correspond toujours', () => {
    // "Bonjour" commence à l'index 9
    expect(resolveNote(text, { start: 9, end: 16, quote: 'Bonjour' })).toEqual({ start: 9, end: 16 });
  });
  it('renvoie null (orphelin) si la citation ne correspond plus', () => {
    expect(resolveNote(text, { start: 9, end: 16, quote: 'Bonsoir' })).toBeNull();
  });
  it('renvoie null si les bornes sont hors limites ou vides', () => {
    expect(resolveNote(text, { start: 9, end: 99, quote: 'Bonjour' })).toBeNull();
    expect(resolveNote(text, { start: 9, end: 9, quote: '' })).toBeNull();
    expect(resolveNote(text, { start: -1, end: 3, quote: 'MIC' })).toBeNull();
  });
});
