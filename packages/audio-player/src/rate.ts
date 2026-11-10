/**
 * Vitesse de lecture : les valeurs du cycle et leur persistance.
 *
 * Ici plutôt que chez l'un des deux lecteurs, parce que les deux la proposent —
 * le chrome du lecteur mobile (et du .html exporté) comme le lecteur web — et
 * qu'ils partagent déjà ce paquet pour `Player.setRate`. Une seconde copie de la
 * liste ou de la clé, c'est deux lecteurs qui finissent par ne plus cycler dans
 * le même ordre ni relire ce que l'autre a écrit.
 */

/** Vitesses de lecture, dans l'ordre du cycle du bouton. */
export const RATES: readonly number[] = [1, 1.5, 2];

/**
 * La vitesse est le rythme de travail de la personne, pas une propriété de la pièce :
 * elle vit donc sous sa propre clé, partagée par toutes les pièces — contrairement aux
 * réglages de lecture, indexés par pièce. Cette clé fonctionne aussi dans le .html
 * exporté, qui n'a aucun accès aux réglages de l'app.
 */
const RATE_KEY = 'theatre-reader:rate';

export function loadRate(): number {
  try {
    const r = Number(localStorage.getItem(RATE_KEY));
    // Une valeur hors cycle rendrait le libellé du bouton incohérent avec ce qu'on
    // entend, et le premier appui la remplacerait sans qu'on sache par quoi.
    if (RATES.some((x) => x === r)) return r;
  } catch {
    /* localStorage indisponible (mode privé, file://) : on ignore */
  }
  return 1;
}

export function saveRate(rate: number): void {
  try {
    localStorage.setItem(RATE_KEY, String(rate));
  } catch {
    /* ignore */
  }
}

/**
 * Vitesse suivante du cycle. Une valeur inconnue repart de la première : c'est le
 * même parti que `loadRate`, un état qu'on ne sait pas nommer ne doit pas décider
 * de la suite.
 */
export function nextRate(current: number): number {
  return RATES[(RATES.indexOf(current) + 1) % RATES.length] ?? 1;
}
