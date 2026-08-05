import { describe, expect, it } from 'vitest';
import { slugify } from './ast';
import { parseFountain } from './fountain';
import {
  COST_PER_LINE,
  INTERVALS,
  MAX_LEVEL,
  type StudyConfig,
  type StudyState,
  addDays,
  budgetForSession,
  daysBetween,
  forecast,
  gradeNodes,
  isoDay,
  newStudyState,
  parseStudyState,
  planSession,
  portionState,
  pruneOrphans,
  splitIntoPortions,
} from './study';

// Un rôle qui couvre les cas qui comptent : une réplique hors de toute scène,
// des répliques courtes dont deux strictement identiques (ordinal de buildNodeIds),
// une tirade nettement plus longue que le budget, et deux actes.
const SRC = `# ACTE I.

BENJI
Je parle avant toute scène ici.

## SCENE I.

GERALD
Bonjour.

BENJI
Ouais.

BENJI
Ouais.

BENJI
Non.

## SCENE II.

BENJI
Une tirade nettement plus longue que les autres pour tester le budget de séance et le découpage.

# ACTE II.

## SCENE I.

BENJI
Fin.
`;

const BENJI = slugify('BENJI');
const GERALD = slugify('GERALD');
const play = parseFountain(SRC);

/** Coûts attendus : 6+K | 1+K | 1+K | 1+K | 17+K | 1+K. */
const BUDGET = 10;
const portions = splitIntoPortions(play, [BENJI], BUDGET);

const TODAY = '2026-08-05';
const config = (over: Partial<StudyConfig> = {}): StudyConfig => ({
  roleIds: [BENJI],
  target: '2026-09-02',
  sessionMinutes: 25,
  daysPerWeek: 7,
  ...over,
});
const state = (over: Partial<StudyConfig> = {}): StudyState => newStudyState(config(over));

describe('dates', () => {
  it('isoDay rend le jour civil local', () => {
    expect(isoDay(new Date(2026, 7, 5, 1, 30))).toBe('2026-08-05');
  });

  it('addDays franchit les mois et les années bissextiles', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('daysBetween est antisymétrique', () => {
    expect(daysBetween('2026-08-05', '2026-09-02')).toBe(28);
    expect(daysBetween('2026-09-02', '2026-08-05')).toBe(-28);
  });

  it('ne corrige pas une date impossible en douce', () => {
    expect(addDays('2026-13-45', 1)).toBe('2026-13-45');
    expect(daysBetween('2026-02-30', '2026-03-01')).toBe(0);
  });
});

describe('splitIntoPortions', () => {
  it('est déterministe', () => {
    expect(splitIntoPortions(play, [BENJI], BUDGET)).toEqual(portions);
  });

  it('découpe selon le budget sans jamais franchir une frontière', () => {
    expect(portions.map((p) => [p.actLabel, p.sceneLabel, p.fromTirade, p.toTirade])).toEqual([
      ['ACTE I.', '', 1, 1], // hors scène
      ['ACTE I.', 'SCENE I.', 2, 3], // deux « Ouais. » : 9 ≤ 10
      ['ACTE I.', 'SCENE I.', 4, 4], // « Non. » ferait 13,5 > 10
      ['ACTE I.', 'SCENE II.', 5, 5],
      ['ACTE II.', 'SCENE I.', 6, 6],
    ]);
  });

  it('garde la réplique qui ne suit aucune scène', () => {
    expect(portions[0]!.sceneId).toBe('h-0');
    expect(portions[0]!.words).toBe(6);
  });

  it('numérote les tirades sans trou ni recouvrement', () => {
    let expected = 1;
    for (const p of portions) {
      expect(p.fromTirade).toBe(expected);
      expect(p.toTirade).toBeGreaterThanOrEqual(p.fromTirade);
      expected = p.toTirade + 1;
    }
    expect(expected - 1).toBe(6);
  });

  it('facture un coût d\'accroche par réplique, pas seulement des mots', () => {
    const short = portions[1]!; // 2 répliques d'un mot
    const long = portions[3]!; // 1 tirade de 17 mots
    expect(short.cost).toBe(2 + 2 * COST_PER_LINE);
    expect(long.cost).toBe(17 + COST_PER_LINE);
    // Même nombre de mots ⇒ coûts différents : c'est tout l'intérêt.
    expect(2 + 2 * COST_PER_LINE).not.toBe(2 + COST_PER_LINE);
  });

  it('isole une réplique plus coûteuse que le budget sans la couper', () => {
    const long = portions[3]!;
    expect(long.cost).toBeGreaterThan(BUDGET);
    expect(long.nodeIds).toHaveLength(1);
  });

  it('compte les répliques courtes', () => {
    expect(portions[1]!.shortLines).toBe(2);
    expect(portions[3]!.shortLines).toBe(0);
  });

  it('budget ≤ 0 → une réplique par portion, sans boucle infinie', () => {
    expect(splitIntoPortions(play, [BENJI], 0)).toHaveLength(6);
  });

  it('rôle sans réplique ou liste vide → aucune portion', () => {
    expect(splitIntoPortions(play, [slugify('PERSONNE')], BUDGET)).toEqual([]);
    expect(splitIntoPortions(play, [], BUDGET)).toEqual([]);
  });

  it('ignore les répliques des autres rôles', () => {
    const all = splitIntoPortions(play, [BENJI, GERALD], BUDGET);
    expect(all.reduce((n, p) => n + p.lines, 0)).toBe(7); // 6 BENJI + 1 GERALD
  });

  it('donne des ids distincts, dérivés des nœuds', () => {
    expect(new Set(portions.map((p) => p.id)).size).toBe(portions.length);
  });
});

describe('gradeNodes', () => {
  const ids = portions[1]!.nodeIds;

  it('« su » monte d\'un niveau et espace selon l\'échelle', () => {
    const next = gradeNodes(state(), ids, 'good', TODAY);
    expect(next.progress[ids[0]!]).toEqual({
      level: 1,
      due: addDays(TODAY, INTERVALS[1]!),
      lastSeen: TODAY,
    });
  });

  it('« hésitant » garde le niveau et reprogramme à deux jours', () => {
    const once = gradeNodes(state(), ids, 'good', TODAY);
    const next = gradeNodes(once, ids, 'hard', TODAY);
    expect(next.progress[ids[0]!]!.level).toBe(1);
    expect(next.progress[ids[0]!]!.due).toBe(addDays(TODAY, 2));
  });

  it('« pas su » redescend d\'un niveau et reprogramme à demain', () => {
    const once = gradeNodes(state(), ids, 'good', TODAY);
    const next = gradeNodes(once, ids, 'again', TODAY);
    expect(next.progress[ids[0]!]!.level).toBe(0);
    expect(next.progress[ids[0]!]!.due).toBe(addDays(TODAY, 1));
  });

  it('plancher à 0 et plafond à MAX_LEVEL, sans intervalle indéfini', () => {
    let s = state();
    for (let i = 0; i < 10; i++) s = gradeNodes(s, ids, 'good', TODAY);
    expect(s.progress[ids[0]!]!.level).toBe(MAX_LEVEL);
    expect(s.progress[ids[0]!]!.due).toBe(addDays(TODAY, INTERVALS[MAX_LEVEL]!));
    expect(INTERVALS[MAX_LEVEL]).toBeDefined();

    let t = gradeNodes(state(), ids, 'again', TODAY);
    t = gradeNodes(t, ids, 'again', TODAY);
    expect(t.progress[ids[0]!]!.level).toBe(0);
  });

  it('ne mute pas l\'état d\'entrée', () => {
    const before = state();
    gradeNodes(before, ids, 'good', TODAY);
    expect(before.progress).toEqual({});
  });
});

describe('portionState', () => {
  it('une portion jamais vue est à zéro', () => {
    expect(portionState(portions[1]!, state())).toEqual({
      seen: 0,
      total: 2,
      level: 0,
      due: null,
    });
  });

  it('une portion partiellement vue retombe au niveau 0', () => {
    const p = portions[1]!;
    const s = gradeNodes(state(), [p.nodeIds[0]!], 'good', TODAY);
    expect(portionState(p, s)).toMatchObject({ seen: 1, total: 2, level: 0 });
  });

  it('prend le niveau du maillon faible et l\'échéance la plus proche', () => {
    const p = portions[1]!;
    let s = gradeNodes(state(), p.nodeIds, 'good', TODAY);
    s = gradeNodes(s, [p.nodeIds[1]!], 'again', TODAY);
    expect(portionState(p, s)).toMatchObject({ seen: 2, level: 0, due: addDays(TODAY, 1) });
  });
});

describe('planSession', () => {
  it('programme du neuf dans l\'ordre de la pièce quand rien n\'est dû', () => {
    const s = planSession(portions, state(), TODAY);
    expect(s.due).toEqual([]);
    expect(s.fresh[0]).toBe(portions[0]);
    expect(s.minutes).toBeGreaterThan(0);
  });

  it('fait passer les révisions dues avant le neuf, la plus en retard d\'abord', () => {
    let st = gradeNodes(state(), portions[2]!.nodeIds, 'again', addDays(TODAY, -5));
    st = gradeNodes(st, portions[1]!.nodeIds, 'again', addDays(TODAY, -1));
    const s = planSession(portions, st, TODAY);
    expect(s.due).toEqual([portions[2], portions[1]]);
  });

  it('retient toutes les dues même au-delà de la durée de séance', () => {
    let st = state({ sessionMinutes: 1 });
    for (const p of portions) st = gradeNodes(st, p.nodeIds, 'again', addDays(TODAY, -1));
    const s = planSession(portions, st, TODAY);
    expect(s.due).toHaveLength(portions.length);
    expect(s.minutes).toBeGreaterThan(1);
  });

  it('programme quand même une portion plus coûteuse que la séance entière', () => {
    // La tirade seule coûte 20,5 → 4,6 min, bien au-delà d'une séance de 2 min.
    const only = [portions[3]!];
    const s = planSession(only, state({ sessionMinutes: 2 }), TODAY);
    expect(s.fresh).toEqual(only);
  });

  it('passé la date d\'atterrissage, plus rien de neuf', () => {
    const st = gradeNodes(state(), portions[0]!.nodeIds, 'again', addDays(TODAY, -1));
    const s = planSession(portions, st, '2026-09-03');
    expect(s.fresh).toEqual([]);
    expect(s.due).toHaveLength(1);
  });

  it('liste les nodeId décrochés du texte', () => {
    const st: StudyState = {
      ...state(),
      progress: { 'fantome#0': { level: 2, due: TODAY, lastSeen: TODAY } },
    };
    expect(planSession(portions, st, TODAY).orphans).toEqual(['fantome#0']);
    expect(Object.keys(pruneOrphans(st, portions).progress)).toEqual([]);
  });
});

describe('forecast', () => {
  it('annonce « dans les temps » quand la marge est large', () => {
    expect(forecast(portions, state(), TODAY).status).toBe('ok');
  });

  it('annonce « tendu » quand le besoin frôle la capacité', () => {
    const f = forecast(portions, state({ target: addDays(TODAY, 5), sessionMinutes: 5 }), TODAY);
    expect(f.status).toBe('tight');
    expect(f.daysLeft).toBe(4);
  });

  it('annonce « hors délai » quand le besoin dépasse la capacité', () => {
    expect(forecast(portions, state({ target: addDays(TODAY, 3), sessionMinutes: 5 }), TODAY).status)
      .toBe('late');
  });

  it('sans jour restant mais avec du texte neuf → hors délai, sans NaN ni Infinity', () => {
    const f = forecast(portions, state({ target: addDays(TODAY, 1) }), TODAY);
    expect(f.daysLeft).toBe(0);
    expect(f.status).toBe('late');
    expect(Number.isFinite(f.neededPerDay)).toBe(true);
  });

  it('plus rien à apprendre → dans les temps, même après la date', () => {
    let st = state({ target: addDays(TODAY, -10) });
    for (const p of portions) st = gradeNodes(st, p.nodeIds, 'good', TODAY);
    const f = forecast(portions, st, TODAY);
    expect(f.portionsLeft).toBe(0);
    expect(f.status).toBe('ok');
  });

  it('budgetForSession réserve une part aux révisions', () => {
    expect(budgetForSession(25)).toBeCloseTo(67.5);
  });
});

describe('parseStudyState', () => {
  const valid = gradeNodes(state(), portions[0]!.nodeIds, 'good', TODAY);

  it('accepte un état valide sans le déformer', () => {
    expect(parseStudyState(JSON.parse(JSON.stringify(valid)))).toEqual(valid);
  });

  it('rejette ce qui n\'est pas exploitable', () => {
    expect(parseStudyState(null)).toBeNull();
    expect(parseStudyState('x')).toBeNull();
    expect(parseStudyState({ ...valid, version: 2 })).toBeNull();
    expect(parseStudyState({ ...valid, config: { ...config(), target: '02/09/2026' } })).toBeNull();
    expect(parseStudyState({ ...valid, config: { ...config(), target: '2026-02-30' } })).toBeNull();
    expect(parseStudyState({ ...valid, config: { ...config(), roleIds: [] } })).toBeNull();
    expect(parseStudyState({ ...valid, config: { ...config(), daysPerWeek: 9 } })).toBeNull();
  });

  it('borne les niveaux et écarte les entrées de progression malformées', () => {
    const parsed = parseStudyState({
      ...valid,
      progress: {
        bon: { level: 99, due: TODAY, lastSeen: TODAY },
        casse: { level: 1, due: 'hier', lastSeen: TODAY },
        vide: null,
      },
    });
    expect(parsed!.progress).toEqual({ bon: { level: MAX_LEVEL, due: TODAY, lastSeen: TODAY } });
  });
});
