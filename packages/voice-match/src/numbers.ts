/**
 * Équivalence des nombres écrits en chiffres et en lettres.
 *
 * `22`, `vingt-deux` et `vingt deux` doivent valoir la même chose : la pièce écrit
 * l'une des formes, la reconnaissance vocale rend l'autre selon son humeur, et
 * personne ne prononce différemment. Toute suite de mots-nombres est donc repliée
 * en UN jeton `#<valeur>` — un seul jeton, sinon `22` (un mot) et `vingt deux`
 * (deux mots) ne s'aligneraient déjà plus.
 *
 * Le `raw` du jeton produit garde les mots d'origine, pour que l'affichage des
 * écarts montre « vingt-deux » et non « #22 ».
 */
import type { Token } from './normalize';

/** Unités et dizaines simples, y compris les formes que la reconnaissance produit. */
const UNITS = new Map<string, number>([
  ['zero', 0],
  ['un', 1],
  ['une', 1],
  ['deux', 2],
  ['trois', 3],
  ['quatre', 4],
  ['cinq', 5],
  ['six', 6],
  ['sept', 7],
  ['huit', 8],
  ['neuf', 9],
  ['dix', 10],
  ['onze', 11],
  ['douze', 12],
  ['treize', 13],
  ['quatorze', 14],
  ['quinze', 15],
  ['seize', 16],
  ['vingt', 20],
  ['vingts', 20],
  ['trente', 30],
  ['quarante', 40],
  ['cinquante', 50],
  ['soixante', 60],
]);

/** Multiplicateurs : ils composent ce qui précède au lieu de s'y ajouter. */
const SCALES = new Map<string, number>([
  ['cent', 100],
  ['cents', 100],
  ['mille', 1000],
  ['milles', 1000],
  ['million', 1_000_000],
  ['millions', 1_000_000],
]);

/** Chiffres purs : `22`, mais pas `22e` ni `3h`. */
const DIGITS_RE = /^\d+$/;

function valueOf(key: string): number | null {
  const unit = UNITS.get(key);
  if (unit !== undefined) return unit;
  const scale = SCALES.get(key);
  if (scale !== undefined) return scale;
  return null;
}

/** Ce qu'un `et` peut lier à l'intérieur d'un nombre — `vingt et un`, `soixante et onze`. */
const AFTER_ET = new Set(['un', 'une', 'onze']);

/**
 * Longueur de la suite de mots-nombres qui commence à `at`, et sa valeur.
 *
 * `et` n'est avalé que devant `un` ou `onze`, les deux seules jonctions du
 * français. Le tolérer entre deux nombres quelconques repliait « deux et trois »
 * en `#5` — une addition que personne n'a prononcée.
 */
function readNumber(tokens: Token[], at: number): { length: number; value: number } | null {
  let total = 0;
  let current = 0;
  let seen = 0;
  let i = at;
  while (i < tokens.length) {
    const t = tokens[i]!;
    if (t.key === 'et' && seen > 0 && i + 1 < tokens.length && AFTER_ET.has(tokens[i + 1]!.key)) {
      i++;
      continue;
    }
    const digits = DIGITS_RE.test(t.key) ? Number(t.key) : null;
    if (digits !== null) {
      // Un nombre en chiffres se suffit à lui-même : il n'entre pas en composition
      // avec les mots qui l'entourent (« 3 mille » n'existe pas à l'écrit).
      if (seen > 0) break;
      return { length: 1, value: digits };
    }
    const v = valueOf(t.key);
    if (v === null) break;
    if (v >= 1000) {
      total += Math.max(current, 1) * v;
      current = 0;
    } else if (v === 100) {
      current = Math.max(current, 1) * 100;
    } else if (v === 20 && current === 4) {
      // `quatre-vingt` : la seule dizaine française qui multiplie au lieu d'ajouter.
      // Sans ce cas, `quatre-vingt-dix-sept` vaudrait 31.
      current = 80;
    } else {
      current += v;
    }
    seen++;
    i++;
  }
  if (seen === 0) return null;
  return { length: i - at, value: total + current };
}

/**
 * Replie les suites de mots-nombres. Les jetons non numériques passent tels quels.
 *
 * `un` / `une` SEULS restent des mots : ce sont des articles neuf fois sur dix, et
 * les replier leur donnerait le poids d'un nombre — se tromper d'article deviendrait
 * aussi grave que se tromper de chiffre.
 */
export function canonicalizeNumbers(tokens: Token[]): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < tokens.length) {
    const found = readNumber(tokens, i);
    const single = found?.length === 1 && (tokens[i]!.key === 'un' || tokens[i]!.key === 'une');
    if (!found || single) {
      out.push(tokens[i]!);
      i++;
      continue;
    }
    const words = tokens.slice(i, i + found.length);
    out.push({
      key: `#${found.value}`,
      raw: words.map((w) => w.raw).join(' '),
      proper: false,
    });
    i += found.length;
  }
  return out;
}
