/**
 * Découpage d'un texte en mots comparables.
 *
 * Deux formes cohabitent dans chaque jeton, et c'est délibéré :
 * - `key` sert à COMPARER — minuscule, accents dépliés, apostrophes uniformisées,
 *   nombres canonicalisés (cf. `numbers.ts`). La reconnaissance vocale n'écrit ni
 *   les accents ni la ponctuation comme la pièce ; comparer les formes brutes
 *   ferait échouer des répliques parfaitement dites.
 * - `raw` sert à AFFICHER — le mot tel qu'il est écrit dans la pièce. C'est lui
 *   qu'on montre à l'écran quand un mot manque : « Reviendrai » se lit, `reviendrai`
 *   dépouillé de sa majuscule se lit moins bien, et `#22` pas du tout.
 */

import { phoneticKey } from './phonetic';

/** Un mot, dans ses deux formes. */
export interface Token {
  /** Forme comparée. Les nombres portent le préfixe `#` (cf. `canonicalizeNumbers`). */
  key: string;
  /** Forme affichable, telle qu'écrite dans le texte d'origine. */
  raw: string;
  /**
   * Mot capitalisé ailleurs qu'en tête de phrase — un nom propre, en pratique.
   * Se perdre sur le prénom d'un personnage n'est pas la même faute que se perdre
   * sur un article, d'où le poids que `weight.ts` en tire.
   */
  proper: boolean;
  /**
   * Clé phonétique (cf. `phonetic.ts`). Calculée une fois ici plutôt qu'à chaque
   * comparaison : l'alignement croise chaque mot attendu avec chaque mot entendu.
   */
  phon: string;
}

/**
 * Un mot = lettres, chiffres et apostrophes internes. Le tiret n'en fait PAS
 * partie : il faut que `vingt-deux` se découpe comme `vingt deux` pour que les
 * deux écritures produisent le même nombre (exigence explicite de l'issue).
 * L'apostrophe, elle, reste dans le mot : la reconnaissance d'Apple écrit `j'ai`
 * comme la pièce, et la similarité intra-mot absorbe les rares divergences.
 */
const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}'’]*/gu;

/** Fin de phrase : ce qui précède une majuscule sans en faire un nom propre. */
const SENTENCE_END = /[.!?…:;]/;

/** Minuscule, sans accent, apostrophe droite. */
export function fold(word: string): string {
  return word
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’‘ʼ`]/g, "'")
    .toLowerCase();
}

/**
 * Hésitations que la reconnaissance transcrit et qu'aucune pièce n'écrit.
 *
 * Elles ne sont PAS retirées ici : un texte qui contient réellement « ben » doit
 * pouvoir l'attendre. C'est l'évaluation qui les ignore, et seulement parmi les
 * mots entendus EN TROP (cf. `evaluate.ts`) — là où elles ne peuvent rien casser.
 */
export const FILLERS = new Set(['euh', 'heu', 'hem', 'hum', 'mmh', 'mm', 'hmm']);

/** Découpe en mots, sans toucher aux nombres (cf. `tokenize`). */
export function splitWords(text: string): Token[] {
  const out: Token[] = [];
  let sentenceStart = true;
  let cursor = 0;
  for (const m of text.matchAll(WORD_RE)) {
    const raw = m[0];
    const at = m.index ?? cursor;
    // Ce qui sépare ce mot du précédent décide s'il ouvre une phrase — donc si sa
    // majuscule est grammaticale (aucun signal) ou distinctive (un nom propre).
    if (SENTENCE_END.test(text.slice(cursor, at))) sentenceStart = true;
    const first = raw[0] ?? '';
    const key = fold(raw);
    out.push({
      key,
      raw,
      proper: !sentenceStart && first !== first.toLowerCase() && first === first.toUpperCase(),
      phon: phoneticKey(key),
    });
    sentenceStart = false;
    cursor = at + raw.length;
  }
  return out;
}
