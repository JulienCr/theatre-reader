/** Écarts tolérés (machine ou oral, pas un trou dans le texte) : décide si un `del`/`ins` compte. */
import type { Token } from './normalize';

/** « il » avalé à l'oral : « il y a » se dit « y a » (ou « ya »), « il faut » se dit « faut ». */
function elidableIl(t: Token[], i: number): boolean {
  if (t[i]!.key !== 'il') return false;
  const next = t[i + 1]?.key;
  return next === 'faut' || next === 'ya' || (next === 'y' && t[i + 2]?.key === 'a');
}

/** Un mot répété (« très très ») dont au moins un exemplaire a été retrouvé. */
function repeatOfMatched(t: Token[], i: number, matched: ReadonlySet<number>): boolean {
  const key = t[i]!.key;
  for (let k = i - 1; k >= 0 && t[k]!.key === key; k--) if (matched.has(k)) return true;
  for (let k = i + 1; k < t.length && t[k]!.key === key; k++) if (matched.has(k)) return true;
  return false;
}

/**
 * Mot attendu jamais entendu, sans que ce soit une faute.
 * @param matched index attendus que l'alignement a retrouvés
 * @param forgiveNe tolère un « ne » manquant (souple seulement)
 */
export function forgivenDel(expected: Token[], e: number, matched: ReadonlySet<number>, forgiveNe: boolean): boolean {
  if (forgiveNe && expected[e]!.key === 'ne') return true;
  return elidableIl(expected, e) || repeatOfMatched(expected, e, matched);
}

/**
 * Mot entendu en trop, sans que ce soit un ajout.
 * @param matched index entendus que l'alignement a rattachés à un mot attendu
 */
export function forgivenIns(heard: Token[], h: number, matched: ReadonlySet<number>): boolean {
  return elidableIl(heard, h) || repeatOfMatched(heard, h, matched);
}
