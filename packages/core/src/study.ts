/**
 * Plan d'apprentissage d'un rôle : découpage du texte en portions de travail et
 * moteur de répétition espacée. Module pur — ni DOM, ni I/O, ni horloge.
 *
 * **Aucun calendrier n'est stocké.** On persiste la configuration et l'état
 * d'avancement ; la séance du jour est recalculée à chaque ouverture. Prendre du
 * retard redistribue la charge sans intervention, là où un planning figé devient
 * faux dès la première séance manquée.
 *
 * **L'état est ancré sur les `nodeId` (cf. `buildNodeIds`), jamais sur les
 * portions.** Une portion est une vue calculée dont la taille dépend du budget de
 * séance : indexer la progression par portion ferait qu'un simple passage de 25 à
 * 30 minutes par séance effacerait tout l'historique. Ancrée par nœud, elle
 * survit au redécoupage, aux retouches du texte et au changement de rôle.
 *
 * Limite connue et assumée, héritée de `buildNodeIds` : un id vaut
 * `hash(contenu)#ordinal`, où l'ordinal départage les nœuds de contenu identique
 * dans l'ordre du document. Supprimer ou insérer une occurrence AVANT un doublon
 * exact décale l'ordinal des suivantes, donc la progression peut se déplacer d'une
 * occurrence à l'autre (un rôle fait de « Ouais. » répétés y est exposé). C'est la
 * même limite que les notes, qui vivent avec depuis le début ; on ne construit pas
 * d'ancrage parallèle pour autant.
 *
 * Le temps est toujours reçu en paramètre (`today`, au format « YYYY-MM-DD »), ce
 * qui rend le moteur testable sans geler l'horloge. C'est l'appelant qui fait
 * `isoDay(new Date())`.
 */

import type { Play } from './ast';
import { speechText } from './ast';
import { buildNodeIds } from './notes';
import { sceneSpans } from './scenes';

/**
 * Coût d'accroche d'une réplique, en « mots équivalents ».
 *
 * Compter les mots seuls ne marche pas sur du théâtre : une scène de vingt
 * « Ouais » pèse 40 mots et coûte pourtant une séance entière, parce que le travail
 * y est dans l'enchaînement, pas dans le texte. Ce terme fixe par réplique met une
 * scène en ping-pong et une longue tirade à des charges comparables.
 */
export const COST_PER_LINE = 3.5;
/** Unités de coût travaillées en une minute (acquisition). */
export const COST_PER_MINUTE = 4.5;
/** Une révision coûte cette fraction de l'acquisition. */
export const REVIEW_FACTOR = 0.35;
/** Part d'une séance réservée au texte neuf ; le reste va aux révisions. */
export const NEW_BUDGET_RATIO = 0.6;
/** Part des jours restants gardée pour les filages de fin. */
export const LANDING_RESERVE = 0.8;
/** Une réplique de ce nombre de mots ou moins compte comme « courte ». */
export const SHORT_LINE_WORDS = 5;
/** Échelle d'espacement, en jours, indexée par niveau de maîtrise. */
export const INTERVALS = [1, 3, 7, 14, 30, 60];
/** Niveau maximum : lié à la longueur de l'échelle, pour qu'aucun index ne sorte. */
export const MAX_LEVEL = INTERVALS.length - 1;
/** Heure de début d'une séance, faute de réglage. */
export const DEFAULT_START_TIME = '19:30';
/**
 * Projection prudente : une portion sur trois est supposée repasser en
 * « hésitant ». Projeter un sans-faute donnerait un calendrier que personne ne
 * tient ; ce taux allonge la prévision de la part de révisions qu'on observe en
 * pratique. C'est une hypothèse, pas une mesure — d'où le nom.
 */
export const PROJECTION_HARD_EVERY = 3;

// Calibrage vérifié sur le rôle de BENJI (« Tout le monde se tire ») : 157
// répliques, 1 584 mots → coût total 2 133,5, soit ~474 min ≈ 19 séances de
// 25 min. Cohérent avec l'estimation manuelle de 8 à 12 heures.

export interface StudyConfig {
  /** Rôles appris (plusieurs : un comédien peut doubler). */
  roleIds: string[];
  /** Date d'atterrissage, « YYYY-MM-DD ». */
  target: string;
  sessionMinutes: number;
  /** 1..7 — capacité quotidienne, et rythme de la projection. */
  daysPerWeek: number;
  /**
   * Heure de début des séances pour l'export calendrier, « HH:MM ». Absente sur
   * un plan écrit avant cette option : `DEFAULT_START_TIME` s'applique alors
   * (même défensive que les options de template, cf. CLAUDE.md).
   */
  startTime?: string;
}

export interface NodeState {
  /** 0..MAX_LEVEL — position dans l'échelle d'espacement. */
  level: number;
  /** Prochaine révision, « YYYY-MM-DD ». */
  due: string;
  lastSeen: string;
}

export interface StudyState {
  version: 1;
  config: StudyConfig;
  /** Indexé par `nodeId`. Voir l'en-tête du module. */
  progress: Record<string, NodeState>;
}

/** Une tranche de texte à travailler d'un coup. Vue calculée, jamais persistée. */
export interface Portion {
  /**
   * Dérivé des `nodeId` des extrémités : unique (les plages sont disjointes) et
   * stable tant que le texte ne bouge pas. Clé de liste et de sélection
   * UNIQUEMENT — la progression est indexée par `nodeId`, pas par cet id.
   */
  id: string;
  actLabel: string;
  sceneLabel: string;
  /** `h-<index>`, comme `buildToc`. */
  sceneId: string;
  /** Numéro de la première réplique du rôle dans la portion (1-based). */
  fromTirade: number;
  toTirade: number;
  nodeIds: string[];
  /**
   * Début de la première réplique parlée, tronqué. Un numéro de tirade ne dit
   * rien à un comédien : c'est l'incipit qui lui fait reconnaître le passage.
   */
  preview: string;
  /**
   * Idem pour la DERNIÈRE réplique parlée. Les deux ensemble bornent le passage :
   * l'incipit seul dit où l'on commence, jamais jusqu'où l'on va. Égal à `preview`
   * quand la portion tient en une réplique — l'appelant n'affiche alors qu'une ligne.
   */
  previewEnd: string;
  words: number;
  lines: number;
  shortLines: number;
  cost: number;
}

/** Auto-évaluation en fin de portion. */
export type Grade = 'again' | 'hard' | 'good';

export interface Session {
  /** À réviser, les plus en retard d'abord. */
  due: Portion[];
  /** Texte neuf du jour. */
  fresh: Portion[];
  /** `nodeId` progressés qui ne correspondent plus à aucun nœud (texte modifié). */
  orphans: string[];
  /** Charge estimée de la séance, en minutes. */
  minutes: number;
}

export interface Forecast {
  status: 'ok' | 'tight' | 'late';
  /** Jours travaillables restants, réserve de filage déduite. */
  daysLeft: number;
  /** Portions jamais abordées. */
  portionsLeft: number;
  neededPerDay: number;
  capacityPerDay: number;
}

const DAY_MS = 86_400_000;
const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * Jour civil « YYYY-MM-DD » d'un instant, dans le fuseau de l'utilisateur —
 * volontairement local : à 1 h du matin à Paris, la séance du jour est celle
 * d'aujourd'hui, pas celle d'hier à Greenwich.
 */
export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** « YYYY-MM-DD » → millisecondes UTC ; `NaN` si la forme ou la date est invalide. */
function dayMs(day: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return NaN;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const ms = Date.UTC(y, mo - 1, d);
  // Date.UTC accepte les débordements (mois 13, jour 45) en décalant l'année :
  // on refuse ces dates plutôt que de les corriger en douce.
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
    return NaN;
  }
  return ms;
}

/**
 * Décale un jour civil. L'arithmétique se fait en UTC : en heure locale, ajouter
 * un jour au passage à l'heure d'été donnerait 23 ou 25 heures.
 */
export function addDays(day: string, n: number): string {
  const ms = dayMs(day);
  if (Number.isNaN(ms)) return day;
  const d = new Date(ms + n * DAY_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Nombre de jours de `from` à `to` (négatif si `to` précède). 0 si une date est invalide. */
export function daysBetween(from: string, to: string): number {
  const a = dayMs(from);
  const b = dayMs(to);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / DAY_MS);
}

/** Budget de coût alloué au texte neuf d'une séance. */
export function budgetForSession(sessionMinutes: number): number {
  return sessionMinutes * COST_PER_MINUTE * NEW_BUDGET_RATIO;
}

export function newStudyState(config: StudyConfig): StudyState {
  return { version: 1, config, progress: {} };
}

function countWords(t: string): number {
  return t.split(/\s+/).filter(Boolean).length;
}

/** Longueur de l'incipit d'une portion, en caractères. */
export const PREVIEW_CHARS = 90;

/** Tronque sur une frontière de mot, sans couper le dernier en deux. */
function truncateWords(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * Découpe les répliques des `roleIds` en portions d'au plus `budgetCost`.
 *
 * Quatre propriétés tiennent par construction :
 * - aucune portion ne franchit une frontière d'acte ou de scène — la portion
 *   courante est refermée ENTRE les plages de `sceneSpans`, ce n'est pas un
 *   test que l'on pourrait oublier d'écrire ;
 * - une scène plus courte que le budget donne une portion plus courte, sans
 *   regroupement avec la suivante ;
 * - une réplique dont le coût dépasse à elle seule le budget forme sa propre
 *   portion : on ne coupe jamais une réplique en deux (la plus longue tirade de
 *   BENJI coûte 147,5 pour un budget de 112,5 à 25 min) ;
 * - `budgetCost` ≤ 0 dégénère proprement en une réplique par portion.
 */
export function splitIntoPortions(play: Play, roleIds: string[], budgetCost: number): Portion[] {
  const roles = new Set(roleIds);
  if (!roles.size) return [];
  const ids = buildNodeIds(play);
  const out: Portion[] = [];
  let tirade = 0;

  for (const span of sceneSpans(play)) {
    let cur: Portion | null = null;
    for (let i = span.from; i < span.to; i++) {
      const n = play.nodes[i]!;
      if (n.type !== 'line' || !roles.has(n.characterId)) continue;
      const spoken = speechText(n);
      const words = countWords(spoken);
      const cost = words + COST_PER_LINE;
      if (cur && cur.cost + cost > budgetCost) {
        out.push(cur);
        cur = null;
      }
      tirade++;
      if (!cur) {
        cur = {
          id: '',
          actLabel: span.actLabel,
          sceneLabel: span.sceneLabel,
          sceneId: span.id,
          fromTirade: tirade,
          toTirade: tirade,
          nodeIds: [],
          preview: '',
          previewEnd: '',
          words: 0,
          lines: 0,
          shortLines: 0,
          cost: 0,
        };
      }
      // Répliques qui disent quelque chose : une réplique faite d'une seule
      // didascalie ne ferait reconnaître aucun passage.
      if (spoken) {
        const excerpt = truncateWords(spoken, PREVIEW_CHARS);
        if (!cur.preview) cur.preview = excerpt;
        cur.previewEnd = excerpt;
      }
      cur.nodeIds.push(ids[i]!);
      cur.words += words;
      cur.lines++;
      if (words <= SHORT_LINE_WORDS) cur.shortLines++;
      cur.cost += cost;
      cur.toTirade = tirade;
    }
    if (cur) out.push(cur);
  }

  for (const p of out) p.id = `${p.nodeIds[0]}~${p.nodeIds[p.nodeIds.length - 1]}`;
  return out;
}

/**
 * Applique une auto-évaluation à tous les nœuds d'une portion. Immutable.
 *
 * Un nœud jamais vu démarre au niveau 0 : un premier « su » l'envoie donc au
 * niveau 1, soit une révision dans 3 jours.
 */
export function gradeNodes(
  state: StudyState,
  nodeIds: string[],
  grade: Grade,
  today: string,
): StudyState {
  const progress = { ...state.progress };
  for (const id of nodeIds) {
    const level = progress[id]?.level ?? 0;
    let next: number;
    let due: string;
    if (grade === 'again') {
      next = Math.max(0, level - 1);
      due = addDays(today, 1);
    } else if (grade === 'hard') {
      next = level;
      due = addDays(today, 2);
    } else {
      next = Math.min(MAX_LEVEL, level + 1);
      due = addDays(today, INTERVALS[next]!);
    }
    progress[id] = { level: next, due, lastSeen: today };
  }
  return { ...state, progress };
}

/**
 * État agrégé d'une portion, « au maillon faible » : le niveau est le minimum de
 * ses nœuds, et retombe à 0 dès qu'un seul n'a jamais été vu — une portion à
 * moitié travaillée n'est pas à moitié sue. `due` est la plus proche échéance.
 *
 * Exporté pour que l'écran n'ait pas à réimplémenter la règle.
 */
export function portionState(
  portion: Portion,
  state: StudyState,
): { seen: number; total: number; level: number; due: string | null } {
  const total = portion.nodeIds.length;
  let seen = 0;
  let level = MAX_LEVEL;
  let due: string | null = null;
  for (const id of portion.nodeIds) {
    const s = state.progress[id];
    if (!s) continue;
    seen++;
    if (s.level < level) level = s.level;
    if (due === null || s.due < due) due = s.due;
  }
  if (seen === 0) return { seen: 0, total, level: 0, due: null };
  return { seen, total, level: seen < total ? 0 : level, due };
}

/**
 * Séance du jour : les révisions dues, puis du texte neuf.
 *
 * Les révisions passent avant le neuf — du texte oublié coûte plus cher que du
 * texte jamais vu. Toutes les portions dues sont retenues, même si la charge
 * dépasse `sessionMinutes` : un jour de rattrapage doit s'annoncer comme tel
 * (`minutes` le dit), pas s'amputer en silence.
 */
export function planSession(portions: Portion[], state: StudyState, today: string): Session {
  const states = portions.map((p) => portionState(p, state));

  const dueIdx: number[] = [];
  states.forEach((s, i) => {
    if (s.due !== null && s.due <= today) dueIdx.push(i);
  });
  dueIdx.sort((ia, ib) => {
    const a = states[ia]!;
    const b = states[ib]!;
    const lateA = daysBetween(a.due!, today);
    const lateB = daysBetween(b.due!, today);
    if (lateA !== lateB) return lateB - lateA;
    if (a.level !== b.level) return a.level - b.level;
    // Départage explicite : on ne s'en remet pas à la stabilité de sort().
    return ia - ib;
  });
  const due = dueIdx.map((i) => portions[i]!);

  // Passé la date d'atterrissage, plus rien de neuf : mode entretien.
  const maxFresh = today > state.config.target
    ? 0
    : Math.max(1, Math.ceil(forecast(portions, state, today).neededPerDay));

  let minutes = due.reduce((s, p) => s + p.cost * REVIEW_FACTOR, 0) / COST_PER_MINUTE;
  const fresh: Portion[] = [];
  // Le neuf suit `maxFresh`, le rythme qu'il faut tenir pour la date — et RIEN
  // d'autre. Le plafonner en plus par la charge de la séance laissait les
  // révisions affamer la découverte : mesuré sur le rôle de BENJI, à partir du
  // moment où elles remplissent 25 min, plus aucune portion neuve ne passait, et
  // le plan s'arrêtait à la tirade 117 sur 157 en annonçant pourtant « tendu ».
  // Une séance qui déborde se dit (`minutes`, « journée de rattrapage ») et se
  // corrige en allongeant les séances ou en reculant la date ; un rôle qu'on
  // n'apprend jamais ne se voit pas.
  for (let i = 0; i < portions.length && fresh.length < maxFresh; i++) {
    if (states[i]!.seen !== 0) continue;
    const p = portions[i]!;
    fresh.push(p);
    minutes += p.cost / COST_PER_MINUTE;
  }

  const known = new Set<string>();
  for (const p of portions) for (const id of p.nodeIds) known.add(id);
  const orphans = Object.keys(state.progress).filter((id) => !known.has(id));

  return { due, fresh, orphans, minutes };
}

/**
 * La date d'atterrissage tient-elle ?
 *
 * `capacityPerDay` divise la séance ENTIÈRE par le coût MOYEN des portions
 * restantes. Deux choix, tous deux nécessaires :
 *
 * - diviser par le coût moyen plutôt que de compter 1 portion/jour : les
 *   frontières de scène produisent des portions plus petites que le budget
 *   (mesuré 48,5 pour un budget de 67,5), un compte à l'unité sous-estimerait la
 *   capacité de près de 40 % ;
 * - prendre la séance entière et non `budgetForSession` : le ratio de 0,6 borne
 *   la taille d'une portion DANS la séance du jour, pour qu'il reste de la place
 *   aux révisions. L'appliquer aussi ici compterait deux fois la même marge — la
 *   réserve de 20 % des jours et le seuil à 0,8 en tiennent déjà lieu — et
 *   annonçait « hors délai » un rôle qui tient : le rôle de BENJI (474 min de
 *   travail pour 550 min disponibles) sortait en retard alors qu'il passe.
 */
export function forecast(portions: Portion[], state: StudyState, today: string): Forecast {
  const fresh = portions.filter((p) => portionState(p, state).seen === 0);
  const portionsLeft = fresh.length;
  const calendar = Math.max(0, daysBetween(today, state.config.target));
  const daysLeft = Math.floor(((calendar * state.config.daysPerWeek) / 7) * LANDING_RESERVE);
  const neededPerDay = portionsLeft / Math.max(1, daysLeft);
  const avgCost = portionsLeft
    ? fresh.reduce((s, p) => s + p.cost, 0) / portionsLeft
    : 1;
  const capacityPerDay = (state.config.sessionMinutes * COST_PER_MINUTE) / Math.max(1, avgCost);
  const ratio = capacityPerDay > 0 ? neededPerDay / capacityPerDay : Infinity;
  const status: Forecast['status'] =
    portionsLeft === 0 ? 'ok'
    : daysLeft <= 0 ? 'late'
    : ratio <= 0.8 ? 'ok'
    : ratio <= 1 ? 'tight'
    : 'late';
  return { status, daysLeft, portionsLeft, neededPerDay, capacityPerDay };
}

/**
 * Plages de tirades couvertes par un ensemble de portions, fusionnées quand elles
 * se touchent. « 34 tirades à revoir » ne dit pas lesquelles ; « 1→34 » le dit, et
 * tient sur une ligne là où quatorze plages séparées ne tiendraient pas.
 */
export function mergeTiradeRanges(portions: Portion[]): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  for (const p of [...portions].sort((a, b) => a.fromTirade - b.fromTirade)) {
    const last = out[out.length - 1];
    if (last && p.fromTirade <= last.to + 1) last.to = Math.max(last.to, p.toTirade);
    else out.push({ from: p.fromTirade, to: p.toTirade });
  }
  return out;
}

/** Une journée de travail telle que la projection l'anticipe. */
export interface PlannedDay {
  /** « YYYY-MM-DD ». */
  day: string;
  due: Portion[];
  fresh: Portion[];
  minutes: number;
}

/**
 * Jours travaillés à partir de `from`, à raison de `daysPerWeek` par semaine.
 *
 * `daysPerWeek` ne dit pas QUELS jours — le moteur s'en sert pour la capacité, et
 * personne n'a saisi de calendrier hebdomadaire. La projection doit pourtant poser
 * des dates : convention, on travaille les `daysPerWeek` premiers jours de chaque
 * période de sept. Arbitraire mais explicable, et exact à 7 jours sur 7.
 */
function workingDays(from: string, daysPerWeek: number, until: string, cap: number): string[] {
  const out: string[] = [];
  const span = Math.max(0, daysBetween(from, until));
  for (let i = 0; i <= span && out.length < cap; i++) {
    if (i % 7 < daysPerWeek) out.push(addDays(from, i));
  }
  return out;
}

/**
 * Calendrier prévisionnel jusqu'à la date d'atterrissage, jour par jour.
 *
 * Rien n'est stocké : on rejoue le moteur sur un état simulé, en supposant que
 * chaque portion travaillée est notée « su », sauf une sur `PROJECTION_HARD_EVERY`
 * notée « hésitant ». Le résultat est donc une PRÉVISION, qui se recale d'elle-même
 * dès qu'on ouvre l'app un autre jour ou qu'on note autre chose que prévu.
 *
 * Déterministe : deux appels sur le même état rendent le même calendrier. La
 * variation vient d'un compteur, jamais d'un tirage.
 */
export function projectSchedule(
  portions: Portion[],
  state: StudyState,
  today: string,
  cap = 180,
): PlannedDay[] {
  const out: PlannedDay[] = [];
  let sim = state;
  let graded = 0;

  for (const day of workingDays(today, state.config.daysPerWeek, state.config.target, cap)) {
    const session = planSession(portions, sim, day);
    if (!session.due.length && !session.fresh.length) continue;
    out.push({ day, due: session.due, fresh: session.fresh, minutes: session.minutes });
    for (const p of [...session.fresh, ...session.due]) {
      graded++;
      const grade: Grade = graded % PROJECTION_HARD_EVERY === 0 ? 'hard' : 'good';
      sim = gradeNodes(sim, p.nodeIds, grade, day);
    }
  }
  return out;
}

/** Retire les `nodeId` progressés qui ne correspondent plus à aucune portion. */
export function pruneOrphans(state: StudyState, portions: Portion[]): StudyState {
  const known = new Set<string>();
  for (const p of portions) for (const id of p.nodeIds) known.add(id);
  const progress: Record<string, NodeState> = {};
  for (const [id, s] of Object.entries(state.progress)) if (known.has(id)) progress[id] = s;
  return { ...state, progress };
}

/** Nombre entier dans [min, max], ou `null` hors bornes : pour refuser une config aberrante. */
function boundedNumber(v: unknown, min: number, max: number): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const n = Math.round(v);
  return n >= min && n <= max ? n : null;
}

/**
 * Niveau ramené dans l'échelle. On borne au lieu de refuser : un niveau écrit par
 * une version future doit redescendre à MAX_LEVEL, pas retomber à 0 — sinon du
 * texte su serait à réapprendre.
 */
function clampLevel(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  return Math.min(MAX_LEVEL, Math.max(0, Math.round(v)));
}

/**
 * Valide un état venu du disque ou du réseau. Pur, donc partagé par le serveur
 * (validation du PUT) et les clients.
 *
 * Renvoie `null` si l'état est inexploitable ; les entrées de `progress`
 * malformées sont écartées une à une plutôt que de faire échouer le tout — perdre
 * une ligne de progression vaut mieux que perdre le plan.
 */
export function parseStudyState(value: unknown): StudyState | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (v.version !== 1) return null;

  const c = v.config as Record<string, unknown> | undefined;
  if (!c || typeof c !== 'object') return null;

  const roleIds = Array.isArray(c.roleIds)
    ? c.roleIds.filter((x): x is string => typeof x === 'string')
    : [];
  if (!roleIds.length) return null;

  const target = c.target;
  if (typeof target !== 'string' || Number.isNaN(dayMs(target))) return null;

  const sessionMinutes = boundedNumber(c.sessionMinutes, 1, 240);
  const daysPerWeek = boundedNumber(c.daysPerWeek, 1, 7);
  if (sessionMinutes === null || daysPerWeek === null) return null;

  // Heure absente ou illisible → on retombe sur le défaut plutôt que de refuser
  // le plan : c'est un confort d'export, pas une donnée d'apprentissage.
  const startTime =
    typeof c.startTime === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(c.startTime)
      ? c.startTime
      : DEFAULT_START_TIME;

  const progress: Record<string, NodeState> = {};
  const raw = v.progress;
  if (raw && typeof raw === 'object') {
    for (const [id, entry] of Object.entries(raw as Record<string, unknown>)) {
      if (!entry || typeof entry !== 'object') continue;
      const e = entry as Record<string, unknown>;
      if (typeof e.due !== 'string' || Number.isNaN(dayMs(e.due))) continue;
      if (typeof e.lastSeen !== 'string' || Number.isNaN(dayMs(e.lastSeen))) continue;
      progress[id] = { level: clampLevel(e.level), due: e.due, lastSeen: e.lastSeen };
    }
  }

  return {
    version: 1,
    config: { roleIds, target, sessionMinutes, daysPerWeek, startTime },
    progress,
  };
}
