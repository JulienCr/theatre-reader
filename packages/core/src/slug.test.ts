/**
 * `isValidSlug` garde des chemins de fichiers : elle est appelée sur des valeurs
 * qui viennent parfois d'un corps JSON, donc de type non garanti.
 */
import { describe, expect, it } from 'vitest';
import { isValidSlug, slugify } from './ast';

describe('isValidSlug', () => {
  it('accepte ce que slugify produit', () => {
    for (const nom of ['Le Malade imaginaire', 'ÉLÈVE n°2', 'A', '  ---  ']) {
      expect(isValidSlug(slugify(nom))).toBe(true);
    }
  });

  it('refuse tout ce qui pourrait sortir du dossier', () => {
    for (const s of ['..', '../evade', 'a/b', 'a\\b', '.hidden', 'a.b', '%2F', 'Majuscule', '']) {
      expect(isValidSlug(s)).toBe(false);
    }
  });

  // `RegExp.test` convertit son argument : `test(null)` interrogeait `"null"`,
  // qui appartient à l'alphabet — la garde répondait donc vrai sur `null`.
  it('refuse les valeurs qui ne sont pas des chaînes', () => {
    for (const v of [null, undefined, 42, true, ['evade'], {}]) {
      expect(isValidSlug(v)).toBe(false);
    }
  });
});
