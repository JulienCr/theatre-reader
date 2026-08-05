import { describe, expect, it } from 'vitest';
import { fold } from './normalize';
import { phoneticKey } from './phonetic';

/** Le phonétiseur travaille sur la forme normalisée, comme en vrai. */
const key = (w: string): string => phoneticKey(fold(w));
const same = (...words: string[]): boolean =>
  words.every((w) => key(w) === key(words[0]!));

describe('clé phonétique', () => {
  it('regroupe les homophones qui ont coûté des refus', () => {
    expect(same('o', 'haut', 'eau', 'aux')).toBe(true);
    expect(same('vers', 'vert', 'verre', 'ver')).toBe(true);
    expect(same("c'est", 'ses', 'ces', 'sais', 'sait')).toBe(true);
    expect(same('a', 'à', 'as')).toBe(true);
    expect(same('et', 'est')).toBe(true);
    expect(same('mais', 'mes')).toBe(true);
    expect(same('peu', 'peut', 'peux')).toBe(true);
    expect(same('sans', 'sang', 'cent')).toBe(true);
    expect(same('leur', 'leurre')).toBe(true);
  });

  it('ne fusionne pas des mots qui sonnent différemment', () => {
    expect(same('poisson', 'poison')).toBe(false);
    expect(same('chevelure', 'chevelle')).toBe(false);
    expect(same('pain', 'pan')).toBe(false);
    expect(same('dessert', 'desert')).toBe(false);
    expect(same('bon', 'beau')).toBe(false);
    expect(same('rue', 'roue')).toBe(false);
    expect(same('chat', 'cas')).toBe(false);
  });

  it("garde les nasales ouvertes devant une voyelle ou un doublement", () => {
    expect(same('an', 'ami')).toBe(false);
    expect(same('an', 'année')).toBe(false);
  });

  it('ne vide jamais un mot court', () => {
    for (const w of ['de', 'et', 'a', 'des', 'est', 'eu']) {
      expect(key(w).length).toBeGreaterThan(0);
    }
  });

  it('laisse les nombres canoniques intacts', () => {
    expect(phoneticKey('#22')).toBe('#22');
  });
});
