/**
 * Alignement mot à mot entre la tirade attendue et ce qui a été entendu.
 *
 * Needleman-Wunsch, avec deux écarts au schéma d'école, chacun réclamé par l'issue :
 *
 * 1. **Substitution graduée.** Deux mots proches (`reviendrai` / `reviendrais`)
 *    coûtent presque rien, deux mots étrangers coûtent le prix plein. C'est ce qui
 *    distingue une approximation de transcription d'une vraie erreur de texte, et
 *    c'est pour ça qu'une égalité de chaînes ne peut pas faire le travail.
 *
 * 2. **Départ libre côté « entendu ».** Le début de l'énoncé peut être abandonné
 *    sans pénalité, ce qui est exactement l'autocorrection orale : « Je reviendrai…
 *    non, je ne reviendrai jamais » doit passer. Cette gratuité est BORNÉE
 *    (`maxSkip`) — sans borne, réciter n'importe quoi puis la bonne réplique
 *    passerait aussi, et l'issue l'exclut explicitement.
 */
import type { Token } from './normalize';
import { phoneticKey } from './phonetic';

export type Op =
  /** Mot attendu retrouvé (à la tolérance de similarité près). */
  | { type: 'match'; e: number; h: number }
  /** Mot attendu remplacé par un autre. */
  | { type: 'sub'; e: number; h: number }
  /** Mot attendu jamais prononcé. */
  | { type: 'del'; e: number }
  /** Mot prononcé en trop. */
  | { type: 'ins'; h: number }
  /** Mot prononcé avant la bonne version — l'amorce d'une autocorrection, ignorée. */
  | { type: 'skip'; h: number }
  /**
   * Un mot attendu pour DEUX mots entendus (`h` et `h+1`) : la dictée l'a coupé.
   * N'existe que franc (cf. `mergeCost`) — donc toujours une correspondance.
   */
  | { type: 'merge'; e: number; h: number }
  /** DEUX mots attendus (`e` et `e+1`) pour un seul entendu : la dictée les a collés. */
  | { type: 'split'; e: number; h: number };

export interface AlignOptions {
  /** Nombre de mots que l'énoncé peut gaspiller en tête sans être pénalisé. */
  maxSkip: number;
  /** Similarité à partir de laquelle deux mots comptent comme le même. */
  matchSim: number;
}

const GAP = 1;

function levenshtein(a: string, b: string): number {
  // Une seule ligne courante : les mots font quelques caractères, la matrice
  // complète ne servirait qu'à retrouver le chemin, dont on n'a pas l'usage ici.
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + cost);
    }
    prev = row;
  }
  return prev[b.length]!;
}

/**
 * Deux mots qui sonnent pareil, à la lettre près.
 *
 * Volontairement juste EN DESSOUS de 1 : l'orthographe exacte reste préférée quand
 * l'alignement a le choix, mais la valeur passe tous les seuils de correspondance,
 * y compris en `strict`. C'est voulu — la reconnaissance vocale choisit la graphie,
 * pas l'acteur. Il a dit le bon son ; « haut » pour « o » est une faute de la
 * machine, et la lui reprocher serait lui demander d'articuler autrement un mot
 * qu'il prononce déjà juste.
 */
const HOMOPHONE_SIM = 0.95;

/**
 * Proximité de deux mots, entre 0 et 1.
 *
 * Trois façons de se ressembler, dans l'ordre : la même graphie, le même son, des
 * lettres proches. La deuxième est ce qui rattrape les homophones que la dictée
 * choisit au hasard — `vers`/`vert`/`verre`, `c'est`/`ses`/`ces`, `o`/`haut` —, que
 * la distance sur les lettres classe pourtant comme des mots étrangers.
 *
 * Les nombres n'ont pas de « presque » : `#22` et `#23` partagent deux caractères
 * sur trois, et ce sont pourtant deux répliques différentes. Même chose face à un
 * mot ordinaire — un nombre ne s'approxime pas.
 */
export function similarity(a: Token, b: Token): number {
  if (a.key === b.key) return 1;
  if (a.key.startsWith('#') || b.key.startsWith('#')) return 0;
  if (a.phon && a.phon === b.phon) return HOMOPHONE_SIM;
  const max = Math.max(a.key.length, b.key.length);
  if (max === 0) return 1;
  return 1 - levenshtein(a.key, b.key) / max;
}

/**
 * Deux mots pris comme un seul.
 *
 * La clé phonétique est RECALCULÉE sur la concaténation, jamais obtenue en collant
 * les deux clés : les règles dépendent du contexte, et la coupure en fabrique un
 * faux. « chévé » se termine sur un `e` muet qui disparaît (`Sev`), alors qu'au
 * milieu de « chévéloure » ce même `e` se prononce (`SevelUr`). Recalculer sur
 * « chévélourd » redonne `SevelUr`, et les deux formes se retrouvent.
 */
function joined(a: Token, b: Token): Token {
  const key = a.key + b.key;
  return { key, raw: `${a.raw} ${b.raw}`, proper: a.proper || b.proper, phon: phoneticKey(key) };
}

export function align(expected: Token[], heard: Token[], opts: AlignOptions): Op[] {
  const n = expected.length;
  const m = heard.length;
  const maxSkip = Math.max(0, Math.min(opts.maxSkip, m));

  // Paires adjacentes, calculées une fois : la matrice les consulte n×m fois.
  // `pairH[j]` colle heard[j-1] et heard[j] ; `pairE[i]` fait de même côté attendu.
  const pairH: (Token | null)[] = heard.map((h, j) => (j > 0 ? joined(heard[j - 1]!, h) : null));
  const pairE: (Token | null)[] = expected.map((e, i) => (i > 0 ? joined(expected[i - 1]!, e) : null));
  /**
   * Coût d'un regroupement, ou `Infinity` s'il n'est pas franc.
   *
   * Le seuil est ce qui rend la règle sûre. Sans lui, un regroupement médiocre
   * revient moins cher qu'un mot en trop, et l'alignement se met à coller les
   * voisins pour économiser : « je pars euh demain » devenait « demain remplacé par
   * euh-demain » au lieu de « euh en trop ». Une segmentation différente du MÊME
   * mot est franche ou n'est pas — sinon « mot faux, mot en trop » dit la vérité.
   */
  const mergeCost = (i: number, j: number): number => {
    if (j < 2) return Infinity;
    const s = similarity(expected[i - 1]!, pairH[j - 1]!);
    return s >= opts.matchSim ? 1 - s : Infinity;
  };
  const splitCost = (i: number, j: number): number => {
    if (i < 2) return Infinity;
    const s = similarity(pairE[i - 1]!, heard[j - 1]!);
    return s >= opts.matchSim ? 1 - s : Infinity;
  };

  const cost: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 1; i <= n; i++) cost[i]![0] = i * GAP;
  // La ligne 0 porte toute la règle du départ libre : au-delà de `maxSkip`, les
  // mots gaspillés en tête redeviennent des ajouts ordinaires.
  for (let j = 1; j <= m; j++) cost[0]![j] = j <= maxSkip ? 0 : (j - maxSkip) * GAP;

  for (let i = 1; i <= n; i++) {
    const row = cost[i]!;
    const above = cost[i - 1]!;
    const e = expected[i - 1]!;
    for (let j = 1; j <= m; j++) {
      const sub = above[j - 1]! + (1 - similarity(e, heard[j - 1]!));
      let best = Math.min(sub, above[j]! + GAP, row[j - 1]! + GAP);
      // La dictée décide seule de la segmentation : elle coupe un mot qu'elle ne
      // connaît pas et colle ceux qu'elle croit liés. Ces deux transitions sont ce
      // qui empêche de compter une coupure comme « un mot faux + un mot en trop ».
      if (j >= 2) best = Math.min(best, above[j - 2]! + mergeCost(i, j));
      if (i >= 2) best = Math.min(best, cost[i - 2]![j - 1]! + splitCost(i, j));
      row[j] = best;
    }
  }

  const ops: Op[] = [];
  let i = n;
  let j = m;
  const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;
  while (i > 0 && j > 0) {
    const sim = similarity(expected[i - 1]!, heard[j - 1]!);
    const diagonal = cost[i - 1]![j - 1]! + (1 - sim);
    // Le 1-pour-1 est essayé en premier : à coût égal, deux mots restent deux mots.
    if (near(cost[i]![j]!, diagonal)) {
      ops.push(sim >= opts.matchSim ? { type: 'match', e: i - 1, h: j - 1 } : { type: 'sub', e: i - 1, h: j - 1 });
      i--;
      j--;
    } else if (near(cost[i]![j]!, cost[i - 1]![j - 2]! + mergeCost(i, j))) {
      ops.push({ type: 'merge', e: i - 1, h: j - 2 });
      i--;
      j -= 2;
    } else if (near(cost[i]![j]!, cost[i - 2]![j - 1]! + splitCost(i, j))) {
      ops.push({ type: 'split', e: i - 2, h: j - 1 });
      i -= 2;
      j--;
    } else if (near(cost[i]![j]!, cost[i - 1]![j]! + GAP)) {
      ops.push({ type: 'del', e: i - 1 });
      i--;
    } else {
      ops.push({ type: 'ins', h: j - 1 });
      j--;
    }
  }
  while (i > 0) {
    ops.push({ type: 'del', e: i - 1 });
    i--;
  }
  // Tout ce qui reste devant le premier mot attendu est l'amorce : gratuite dans
  // la limite de `maxSkip`, comptée comme ajout au-delà. Le partage suit à la
  // lettre ce que la ligne 0 a facturé, sinon score et écarts se contrediraient.
  while (j > 0) {
    ops.push(j <= maxSkip ? { type: 'skip', h: j - 1 } : { type: 'ins', h: j - 1 });
    j--;
  }
  return ops.reverse();
}
