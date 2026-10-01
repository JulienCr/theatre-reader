/**
 * Verdict d'une tentative : la tirade a-t-elle été dite, et à quel prix.
 *
 * Quatre issues, celles que l'issue #40 demande de distinguer à l'oreille :
 * `ok` (on enchaîne), `borderline` (validé mais infidèle — des mots en trop, le plus
 * souvent), `fail` (à refaire), `no-speech` (rien d'exploitable — ce n'est pas une
 * faute de texte, et l'app ne doit pas la traiter comme telle).
 *
 * Le résultat est fait pour être AFFICHÉ tel quel : `words` est la tirade attendue
 * mot à mot avec ce qui est arrivé à chacun, `added` ce qui a été prononcé en plus.
 * L'écran n'a rien à recalculer, et rien de ce qui a été entendu n'est conservé
 * au-delà de ces quelques mots.
 */
import { align, similarity, type Op } from './align';
import { FILLERS, splitWords, type Token } from './normalize';
import { canonicalizeNumbers } from './numbers';
import { blocks, weightOf } from './weight';

export type Tolerance = 'strict' | 'soft';
export type Verdict = 'ok' | 'borderline' | 'fail' | 'no-speech';

export interface EvaluatedWord {
  /** Le mot tel qu'il est écrit dans la pièce. */
  text: string;
  status: 'ok' | 'missing' | 'replaced';
  /** Ce qui a été dit à la place (`replaced` seulement). */
  heard?: string;
}

export interface Evaluation {
  verdict: Verdict;
  /**
   * Fidélité : 1 = rien ne manque. Ne tient PAS compte des mots en trop, qui ont
   * leur propre seuil. Sert au verdict, et à rien d'autre — l'écran montre les mots.
   */
  score: number;
  words: EvaluatedWord[];
  /** Mots prononcés en trop, chacun rattaché au mot attendu qui le précède (-1 = avant tout). */
  added: { text: string; after: number }[];
}

interface Profile {
  /** Part de la tirade que l'amorce d'une autocorrection peut gaspiller. */
  maxSkipRatio: number;
  /**
   * Plancher de cette amorce, en mots.
   *
   * Sans lui, une réplique de quatre mots n'autorisait qu'une amorce de deux — or
   * se reprendre demande de redire le début, donc à peu près autant de mots que la
   * réplique elle-même. Le plancher ne rouvre aucune brèche : on ne noie pas quatre
   * mots dans quatre mots, et c'est le ratio qui reprend la main dès que la tirade
   * s'allonge.
   */
  minSkip: number;
  maxSkipAbs: number;
  matchSim: number;
  /** Fidélité minimale pour que la tirade compte comme dite. */
  ok: number;
  /** Poids de mots en trop toléré, en part de la tirade, avant de refuser. */
  maxNoise: number;
  ignoreFillers: boolean;
  strictBlocking: boolean;
  /** `ok` exige alors zéro écart — c'est ce que « fidélité au texte » veut dire. */
  okRequiresPerfect: boolean;
}

/**
 * Les deux niveaux de l'issue. Ils ne touchent QUE des seuils : les normalisations
 * (accents, apostrophes, nombres) restent identiques des deux côtés, parce qu'elles
 * ne relèvent pas de l'indulgence mais de ce que la reconnaissance vocale sait
 * produire. « Strict » veut dire fidèle au texte, pas fidèle à la transcription.
 */
const PROFILES: Record<Tolerance, Profile> = {
  soft: {
    maxSkipRatio: 0.4,
    minSkip: 4,
    maxSkipAbs: 12,
    matchSim: 0.78,
    ok: 0.9,
    maxNoise: 0.5,
    ignoreFillers: true,
    strictBlocking: false,
    okRequiresPerfect: false,
  },
  strict: {
    maxSkipRatio: 0.25,
    minSkip: 3,
    maxSkipAbs: 6,
    matchSim: 0.9,
    ok: 0.97,
    maxNoise: 0.3,
    ignoreFillers: false,
    strictBlocking: true,
    okRequiresPerfect: true,
  },
};

export function tokenize(text: string): Token[] {
  return canonicalizeNumbers(splitWords(text));
}

interface ScoredOps {
  words: EvaluatedWord[];
  added: { text: string; after: number }[];
  lost: number;
  extra: number;
  blocked: boolean;
  /** Un mot plein dit à la place d'un autre : ce n'est plus le texte de la pièce. */
  replacedContent: boolean;
  /** 1 + le plus grand index attendu touché par un op — la portée réellement jugée. */
  reached: number;
}

/** Traduit les ops de l'alignement en écarts. Partagé par `evaluate` (fin fermée) et `evaluatePrefix` (fin libre). */
function scoreOps(expected: Token[], heard: Token[], ops: Op[], p: Profile): ScoredOps {
  const words: EvaluatedWord[] = expected.map((t) => ({ text: t.raw, status: 'missing' }));
  const added: { text: string; after: number }[] = [];
  let lost = 0;
  let extra = 0;
  let blocked = false;
  let replacedContent = false;
  let lastExpected = -1;
  let reached = 0;

  for (const op of ops) {
    switch (op.type) {
      case 'match':
        words[op.e]!.status = 'ok';
        lastExpected = op.e;
        reached = Math.max(reached, op.e + 1);
        break;
      case 'sub': {
        const e = expected[op.e]!;
        words[op.e] = { text: e.raw, status: 'replaced', heard: heard[op.h]!.raw };
        lost += weightOf(e);
        blocked ||= blocks(e, p.strictBlocking);
        replacedContent ||= weightOf(e) >= 2;
        lastExpected = op.e;
        reached = Math.max(reached, op.e + 1);
        break;
      }
      case 'del': {
        const e = expected[op.e]!;
        lost += weightOf(e);
        blocked ||= blocks(e, p.strictBlocking);
        lastExpected = op.e;
        reached = Math.max(reached, op.e + 1);
        break;
      }
      // La dictée a coupé un mot en deux (« chévéloure » → « chévé lourd ») ou collé
      // deux mots en un. Ce n'est pas une faute de l'acteur : le mot a été prononcé,
      // c'est la segmentation qui diffère. Compté comme un seul écart, jamais comme
      // « un mot faux plus un mot en trop ».
      case 'merge':
        words[op.e]!.status = 'ok';
        lastExpected = op.e;
        reached = Math.max(reached, op.e + 1);
        break;
      case 'split':
        words[op.e]!.status = 'ok';
        words[op.e + 1]!.status = 'ok';
        lastExpected = op.e + 1;
        reached = Math.max(reached, op.e + 2);
        break;
      case 'ins': {
        const h = heard[op.h]!;
        if (p.ignoreFillers && FILLERS.has(h.key)) break;
        added.push({ text: h.raw, after: lastExpected });
        extra += weightOf(h);
        break;
      }
      case 'skip':
        // L'amorce d'une autocorrection : ni comptée, ni montrée. La personne s'est
        // reprise d'elle-même, lui rappeler son faux départ n'apprend rien.
        break;
    }
  }

  return { words, added, lost, extra, blocked, replacedContent, reached };
}

export function evaluate(
  expectedText: string,
  heardText: string,
  opts: { tolerance?: Tolerance } = {},
): Evaluation {
  const p = PROFILES[opts.tolerance ?? 'soft'];
  const expected = tokenize(expectedText);
  const heard = tokenize(heardText);

  const words: EvaluatedWord[] = expected.map((t) => ({ text: t.raw, status: 'missing' }));
  if (!expected.length) return { verdict: 'ok', score: 1, words, added: [] };
  if (!heard.length) return { verdict: 'no-speech', score: 0, words, added: [] };

  const ops = align(expected, heard, {
    maxSkip: Math.min(p.maxSkipAbs, Math.max(p.minSkip, Math.ceil(expected.length * p.maxSkipRatio))),
    matchSim: p.matchSim,
  });

  const scored = scoreOps(expected, heard, ops, p);

  const total = expected.reduce((sum, t) => sum + weightOf(t), 0);
  // Deux mesures séparées, et c'est tout le modèle : ce qui MANQUE décide si la
  // tirade est acquise, ce qui est EN TROP décide seulement de la nuance. L'issue
  // les traite d'ailleurs différemment — les mots ajoutés « peuvent produire une
  // validation limite », les mots manquants sont listés parmi les erreurs.
  const fidelity = Math.max(0, Math.min(1, 1 - scored.lost / total));
  const noise = scored.extra / total;

  // Un mot plein perdu n'est jamais « parfait », même quand la tirade est longue
  // assez pour que le score l'absorbe : dire « le lever du soleil » à la place de
  // « du jour » n'est plus la réplique. En strict, `ok` exige zéro écart, point.
  const clean = !scored.added.length && !scored.replacedContent && (!p.okRequiresPerfect || scored.lost === 0);
  let verdict: Verdict;
  if (scored.blocked || fidelity < p.ok || noise > p.maxNoise) verdict = 'fail';
  else if (clean) verdict = 'ok';
  else verdict = 'borderline';

  return { verdict, score: fidelity, words: scored.words, added: scored.added };
}

export interface PrefixEvaluation {
  /** Nombre de mots attendus couverts par l'alignement — pas nécessairement toute la tirade. */
  reached: number;
  /** Longueur de la tirade attendue, en mots — pour que l'appelant sache si `reached` couvre tout. */
  total: number;
  verdict: Verdict;
}

/**
 * En dessous de ce seuil, un « sub » n'est plus une variante du mot attendu : c'est
 * l'alignement qui caserait n'importe quel mot ailleurs faute de mieux. Indépendant
 * de `matchSim`, qui juge la fidélité — pas si c'est encore le même mot.
 */
const PLAUSIBLE_SIM = 0.5;

/**
 * Jusqu'où l'alignement porte une correspondance réelle, en repartant de la fin.
 *
 * L'alignement de `align()` est FERMÉ (`i = n` forcé) : s'il manque la fin du
 * texte entendu, il caserait quand même chaque mot attendu restant quelque part,
 * y compris par des « sub » n'ayant plus rien à voir (`weight.ts` ne s'en soucie
 * pas, lui, c'est `evaluate()` qui reste sur un texte déjà complet). Ici, texte
 * encore en cours : on rembobine la traîne — mots jamais dits (`del`), mots dits
 * en trop qu'aucune suite n'explique (`ins`), ou substitutions trop lointaines
 * pour être une variante du bon mot — jusqu'au dernier point de contact réel.
 */
function trimUnreached(expected: Token[], heard: Token[], ops: Op[]): Op[] {
  let end = ops.length;
  while (end > 0) {
    const op = ops[end - 1]!;
    if (op.type === 'del' || op.type === 'ins') {
      end--;
      continue;
    }
    if (op.type === 'sub' && similarity(expected[op.e]!, heard[op.h]!) < PLAUSIBLE_SIM) {
      end--;
      continue;
    }
    break;
  }
  return ops.slice(0, end);
}

/**
 * Juge un énoncé encore en cours : la tirade n'a pas besoin d'être finie pour que
 * ce qui a été dit jusqu'ici soit fidèle. Utilisé pour distinguer une pause d'une
 * divergence — jamais pour conclure une tentative, qui reste le rôle d'`evaluate`.
 */
export function evaluatePrefix(
  expectedText: string,
  heardText: string,
  opts: { tolerance?: Tolerance } = {},
): PrefixEvaluation {
  const p = PROFILES[opts.tolerance ?? 'soft'];
  const expected = tokenize(expectedText);
  const heard = tokenize(heardText);
  const total = expected.length;

  if (!heard.length) return { reached: 0, total, verdict: 'no-speech' };
  if (!expected.length) return { reached: 0, total: 0, verdict: 'ok' };

  const ops = align(expected, heard, {
    maxSkip: Math.min(p.maxSkipAbs, Math.max(p.minSkip, Math.ceil(expected.length * p.maxSkipRatio))),
    matchSim: p.matchSim,
  });
  const trimmed = trimUnreached(expected, heard, ops);

  const { lost, extra, blocked, reached } = scoreOps(expected, heard, trimmed, p);
  if (reached === 0) return { reached: 0, total, verdict: 'fail' };

  const prefixTotal = expected.slice(0, reached).reduce((sum, t) => sum + weightOf(t), 0);
  const fidelity = prefixTotal > 0 ? Math.max(0, Math.min(1, 1 - lost / prefixTotal)) : 1;
  const noise = prefixTotal > 0 ? extra / prefixTotal : 0;
  const verdict: Verdict = blocked || fidelity < p.ok || noise > p.maxNoise ? 'fail' : 'ok';

  return { reached, total, verdict };
}
