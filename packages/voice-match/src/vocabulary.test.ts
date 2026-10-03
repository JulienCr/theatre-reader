import { describe, expect, it } from 'vitest';
import { buildVocabulary } from './vocabulary';

const known = (...words: string[]) => {
  const set = new Set(words);
  return (w: string) => set.has(w);
};
const none = known();
const all = () => true;

describe('buildVocabulary', () => {
  it('lists character names first, title-cased', () => {
    const out = buildVocabulary({
      characterNames: ['GIUSEPPE', 'VOIX JOURNAL', 'JEAN-LUC', ''],
      speechTexts: [],
      isKnown: all,
    });
    expect(out).toEqual(['Giuseppe', 'Voix Journal', 'Jean-Luc']);
  });

  it('puts mid-sentence capitalised words after names, ignoring sentence starts', () => {
    const out = buildVocabulary({
      characterNames: ['GIUSEPPE'],
      speechTexts: ['Demain je verrai Corléone. Bonjour Giuseppe.'],
      isKnown: known('demain', 'verrai', 'bonjour'),
    });
    expect(out).toEqual(['Giuseppe', 'Corléone']);
  });

  it('orders unknown words by frequency then alphabet', () => {
    const out = buildVocabulary({
      characterNames: [],
      speechTexts: ['zorb chévéloure abc zorb', 'chévéloure zorb'],
      isKnown: none,
    });
    expect(out).toEqual(['zorb', 'chévéloure', 'abc']);
  });

  it('skips known words', () => {
    const out = buildVocabulary({
      characterNames: [],
      speechTexts: ['maison chévéloure'],
      isKnown: known('maison'),
    });
    expect(out).toEqual(['chévéloure']);
  });

  it('respects max and keeps names over the tail', () => {
    const out = buildVocabulary({
      characterNames: ['ANNA', 'BOB'],
      speechTexts: ['aaaa bbbb cccc'],
      isKnown: none,
      max: 3,
    });
    expect(out).toEqual(['Anna', 'Bob', 'aaaa']);
  });

  it('is stable across calls', () => {
    const input = {
      characterNames: ['ANNA'],
      speechTexts: ['un qux zed un Paul bar qux zed'],
      isKnown: none,
    };
    expect(buildVocabulary(input)).toEqual(buildVocabulary(input));
  });

  it('removes duplicates across categories, case and accents', () => {
    const out = buildVocabulary({
      characterNames: ['CORLÉONE'],
      speechTexts: ['Je vois Corleone et corleone puis Corléone'],
      isKnown: none,
    });
    expect(out.filter((w) => w.toLowerCase().startsWith('corl'))).toHaveLength(1);
    expect(out[0]).toBe('Corléone');
  });

  it('yields the names alone when the checker knows every word', () => {
    const out = buildVocabulary({
      characterNames: ['ANNA'],
      speechTexts: ['je vois Paul ici avec chévéloure'],
      isKnown: all,
    });
    expect(out).toEqual(['Anna']);
  });

  it('drops capitalised ordinary words, shouted or not, but keeps shouted unknown ones', () => {
    const out = buildVocabulary({
      characterNames: [],
      speechTexts: ['Il dit : Merci beaucoup, NON jamais, et RTT pour Beethoven.'],
      isKnown: known('dit', 'merci', 'beaucoup', 'non', 'jamais', 'pour'),
    });
    expect(out).toEqual(['Beethoven', 'RTT']);
  });

  it('returns an empty list for empty inputs', () => {
    expect(buildVocabulary({ characterNames: [], speechTexts: [], isKnown: none })).toEqual([]);
  });

  it('never outputs numbers or tokens shorter than 3 characters', () => {
    const out = buildVocabulary({
      characterNames: [],
      speechTexts: ['il a 22 ans et 2024 xy z'],
      isKnown: none,
    });
    expect(out).toEqual(['ans']);
  });

  it('strips elision before checking the word', () => {
    const seen: string[] = [];
    buildVocabulary({
      characterNames: [],
      speechTexts: ["l'aubergine"],
      isKnown: (w) => (seen.push(w), true),
    });
    expect(seen).toEqual(['aubergine']);
  });

  it('keeps the capitalised spelling of a proper noun first seen in lowercase', () => {
    const out = buildVocabulary({
      characterNames: [],
      speechTexts: ['on dit corléone partout.', 'Il a vu Corléone hier.'],
      isKnown: known('dit', 'partout', 'hier'),
    });
    expect(out).toEqual(['Corléone']);
  });
});
