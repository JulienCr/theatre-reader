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
import { align } from './align';
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

  const added: { text: string; after: number }[] = [];
  let lost = 0;
  let extra = 0;
  let blocked = false;
  /** Un mot plein dit à la place d'un autre : ce n'est plus le texte de la pièce. */
  let replacedContent = false;
  let lastExpected = -1;

  for (const op of ops) {
    switch (op.type) {
      case 'match':
        words[op.e]!.status = 'ok';
        lastExpected = op.e;
        break;
      case 'sub': {
        const e = expected[op.e]!;
        words[op.e] = { text: e.raw, status: 'replaced', heard: heard[op.h]!.raw };
        lost += weightOf(e);
        blocked ||= blocks(e, p.strictBlocking);
        replacedContent ||= weightOf(e) >= 2;
        lastExpected = op.e;
        break;
      }
      case 'del': {
        const e = expected[op.e]!;
        lost += weightOf(e);
        blocked ||= blocks(e, p.strictBlocking);
        lastExpected = op.e;
        break;
      }
      // La dictée a coupé un mot en deux (« chévéloure » → « chévé lourd ») ou collé
      // deux mots en un. Ce n'est pas une faute de l'acteur : le mot a été prononcé,
      // c'est la segmentation qui diffère. Compté comme un seul écart, jamais comme
      // « un mot faux plus un mot en trop ».
      case 'merge':
        words[op.e]!.status = 'ok';
        lastExpected = op.e;
        break;
      case 'split':
        words[op.e]!.status = 'ok';
        words[op.e + 1]!.status = 'ok';
        lastExpected = op.e + 1;
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

  const total = expected.reduce((sum, t) => sum + weightOf(t), 0);
  // Deux mesures séparées, et c'est tout le modèle : ce qui MANQUE décide si la
  // tirade est acquise, ce qui est EN TROP décide seulement de la nuance. L'issue
  // les traite d'ailleurs différemment — les mots ajoutés « peuvent produire une
  // validation limite », les mots manquants sont listés parmi les erreurs.
  const fidelity = Math.max(0, Math.min(1, 1 - lost / total));
  const noise = extra / total;

  // Un mot plein perdu n'est jamais « parfait », même quand la tirade est longue
  // assez pour que le score l'absorbe : dire « le lever du soleil » à la place de
  // « du jour » n'est plus la réplique. En strict, `ok` exige zéro écart, point.
  const clean = !added.length && !replacedContent && (!p.okRequiresPerfect || lost === 0);
  let verdict: Verdict;
  if (blocked || fidelity < p.ok || noise > p.maxNoise) verdict = 'fail';
  else if (clean) verdict = 'ok';
  else verdict = 'borderline';

  return { verdict, score: fidelity, words, added };
}
