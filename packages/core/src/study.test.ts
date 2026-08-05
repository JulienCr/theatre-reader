import { describe, expect, it } from 'vitest';
import { slugify } from './ast';
import { parseFountain } from './fountain';
import {
  COST_PER_LINE,
  DAYS_PER_WEEK_MAX,
  DAYS_PER_WEEK_MIN,
  DEFAULT_START_TIME,
  SESSION_MINUTES_MAX,
  SESSION_MINUTES_MIN,
  INTERVALS,
  MAX_LEVEL,
  PREVIEW_CHARS,
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
  projectSchedule,
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

  it('donne à chaque portion l\'incipit de sa première réplique', () => {
    expect(portions[0]!.preview).toBe('Je parle avant toute scène ici.');
    expect(portions[1]!.preview).toBe('Ouais.');
  });

  it('tronque l\'incipit sur une frontière de mot', () => {
    const long = portions[3]!.preview;
    expect(long.length).toBeLessThanOrEqual(PREVIEW_CHARS + 1);
    expect(long.endsWith('…')).toBe(true);
    expect(long.startsWith('Une tirade nettement plus longue')).toBe(true);
    // Pas de mot coupé en deux avant les points de suspension.
    expect(/\s\S*…$/.test(long) || !long.includes(' ')).toBe(true);
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

  it('ne laisse pas les révisions affamer le texte neuf', () => {
    // Toutes les portions sauf la dernière sont dues, la séance est minuscule :
    // le neuf doit passer quand même. Sans cela le rôle ne se termine jamais —
    // mesuré sur BENJI, le plan s'arrêtait à la tirade 117 sur 157.
    let st = state({ sessionMinutes: 1 });
    for (const p of portions.slice(0, -1)) st = gradeNodes(st, p.nodeIds, 'again', addDays(TODAY, -1));
    const s = planSession(portions, st, TODAY);
    expect(s.due.length).toBe(portions.length - 1);
    expect(s.fresh).toEqual([portions[portions.length - 1]]);
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

  // 5 portions pour un coût moyen de 9,6 : à 3 min de séance la capacité vaut
  // 3 × 4,5 / 9,6 ≈ 1,41 portion/jour. Sur 4 jours travaillables il en faut 1,25,
  // soit 89 % de la capacité → tendu ; sur 2 jours il en faut 2,5 → hors délai.
  it('annonce « tendu » quand le besoin frôle la capacité', () => {
    const f = forecast(portions, state({ target: addDays(TODAY, 5), sessionMinutes: 3 }), TODAY);
    expect(f.daysLeft).toBe(4);
    expect(f.status).toBe('tight');
  });

  it('annonce « hors délai » quand le besoin dépasse la capacité', () => {
    expect(forecast(portions, state({ target: addDays(TODAY, 3), sessionMinutes: 3 }), TODAY).status)
      .toBe('late');
  });

  it('ne cumule pas les marges : un rôle qui tient n\'est pas annoncé en retard', () => {
    // 48 unités de coût, séance de 25 min sur 22 jours travaillables : très large.
    const f = forecast(portions, state(), TODAY);
    expect(f.capacityPerDay).toBeGreaterThan(f.neededPerDay);
    expect(f.status).toBe('ok');
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

describe('projectSchedule', () => {
  it('est déterministe', () => {
    expect(projectSchedule(portions, state(), TODAY)).toEqual(
      projectSchedule(portions, state(), TODAY),
    );
  });

  it('commence aujourd\'hui et ne dépasse pas la date d\'atterrissage', () => {
    const days = projectSchedule(portions, state(), TODAY);
    expect(days[0]!.day).toBe(TODAY);
    expect(days.every((d) => d.day <= '2026-09-02')).toBe(true);
    // Jours strictement croissants.
    expect(days.map((d) => d.day)).toEqual([...days.map((d) => d.day)].sort());
    expect(new Set(days.map((d) => d.day)).size).toBe(days.length);
  });

  it('couvre toutes les portions', () => {
    const seen = new Set(projectSchedule(portions, state(), TODAY).flatMap((d) => d.fresh.map((p) => p.id)));
    expect(seen.size).toBe(portions.length);
  });

  it('place les jours de travail en début de semaine civile', () => {
    // 3 jours/semaine → lundi, mardi, mercredi. TODAY est un mercredi, donc la
    // première semaine n'en offre qu'un, puis on reprend le lundi suivant.
    const days = projectSchedule(portions, state({ daysPerWeek: 3 }), TODAY).map((d) => d.day);
    expect(days.slice(0, 4)).toEqual([TODAY, '2026-08-10', '2026-08-11', '2026-08-12']);
  });

  it('travaille tous les jours à 7 jours sur 7', () => {
    const days = projectSchedule(portions, state({ daysPerWeek: 7 }), TODAY).map((d) => d.day);
    expect(days.slice(0, 3)).toEqual([TODAY, '2026-08-06', '2026-08-07']);
  });

  it('prévoit plus de révisions qu\'un sans-faute, puisqu\'une portion sur trois hésite', () => {
    const days = projectSchedule(portions, state(), TODAY);
    expect(days.some((d) => d.due.length > 0)).toBe(true);
  });

  it('ne mute pas l\'état d\'entrée', () => {
    const before = state();
    projectSchedule(portions, before, TODAY);
    expect(before.progress).toEqual({});
  });

  it('rend un calendrier vide quand la date est déjà passée', () => {
    expect(projectSchedule(portions, state({ target: addDays(TODAY, -1) }), TODAY)).toEqual([]);
  });
});

describe('parseStudyState', () => {
  const valid = gradeNodes(state(), portions[0]!.nodeIds, 'good', TODAY);

  it('accepte un état valide et complète l\'heure de séance manquante', () => {
    const parsed = parseStudyState(JSON.parse(JSON.stringify(valid)))!;
    expect(parsed.progress).toEqual(valid.progress);
    // Un plan écrit avant l'option n'est pas refusé : il reçoit le défaut.
    expect(parsed.config).toEqual({ ...valid.config, startTime: DEFAULT_START_TIME });
  });

  it('garde une heure de séance valide et remplace une heure absurde', () => {
    const at = (startTime: string): string | undefined =>
      parseStudyState({ ...valid, config: { ...config(), startTime } })?.config.startTime;
    expect(at('08:05')).toBe('08:05');
    expect(at('25:00')).toBe(DEFAULT_START_TIME);
    expect(at('19h30')).toBe(DEFAULT_START_TIME);
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

  it('applique les mêmes bornes que celles exposées au formulaire', () => {
    // Une borne locale à l'écran et une autre dans le validateur rendaient
    // possible un plan accepté par l'API mais déclaré invalide par l'UI.
    const withMinutes = (sessionMinutes: number): unknown =>
      parseStudyState({ ...valid, config: { ...config(), sessionMinutes } });
    expect(withMinutes(SESSION_MINUTES_MIN)).not.toBeNull();
    expect(withMinutes(SESSION_MINUTES_MAX)).not.toBeNull();
    expect(withMinutes(SESSION_MINUTES_MIN - 1)).toBeNull();
    expect(withMinutes(SESSION_MINUTES_MAX + 1)).toBeNull();

    const withDays = (daysPerWeek: number): unknown =>
      parseStudyState({ ...valid, config: { ...config(), daysPerWeek } });
    expect(withDays(DAYS_PER_WEEK_MIN)).not.toBeNull();
    expect(withDays(DAYS_PER_WEEK_MAX)).not.toBeNull();
    expect(withDays(DAYS_PER_WEEK_MAX + 1)).toBeNull();
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
