import { describe, expect, it } from 'vitest';
import { buildStudyIcs, icsStamp, type IcsOptions } from './ics';
import type { PlannedDay, Portion } from './study';

const portion = (over: Partial<Portion> = {}): Portion => ({
  id: 'a~b',
  actLabel: 'ACTE II.',
  sceneLabel: 'SCENE I.',
  sceneId: 'h-4',
  fromTirade: 1,
  toTirade: 4,
  nodeIds: ['a', 'b'],
  preview: 'Non. Tu peux pas.',
  previewEnd: 'La chévéloure non ! Alors arrête de tricher.',
  words: 39,
  lines: 4,
  shortLines: 2,
  cost: 53,
  ...over,
});

const day = (over: Partial<PlannedDay> = {}): PlannedDay => ({
  day: '2026-08-06',
  due: [],
  fresh: [portion()],
  minutes: 12,
  ...over,
});

const opts: IcsOptions = {
  roleName: 'BENJI',
  playTitle: 'TOUT LE MONDE SE TIRE',
  startTime: '19:30',
  minutes: 25,
  stamp: '20260805T170000Z',
  uidPrefix: 'benji-plan',
};

const lines = (ics: string): string[] => ics.split('\r\n');

describe('buildStudyIcs', () => {
  it('écrit un calendrier importable, en CRLF', () => {
    const ics = buildStudyIcs([day()], opts)!;
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.includes('\n\n')).toBe(false);
    expect(lines(ics)).toContain('BEGIN:VEVENT');
    expect(lines(ics)).toContain('END:VEVENT');
  });

  it('place la séance à l\'heure demandée, en temps flottant', () => {
    const ics = buildStudyIcs([day()], opts)!;
    // Ni Z ni TZID : 19:30 signifie 19:30 dans l'agenda qui importe.
    expect(lines(ics)).toContain('DTSTART:20260806T193000');
    expect(lines(ics)).toContain('DTEND:20260806T195500');
  });

  it('déborde sur le lendemain plutôt que de finir avant de commencer', () => {
    const ics = buildStudyIcs([day()], { ...opts, startTime: '23:50', minutes: 30 })!;
    expect(lines(ics)).toContain('DTSTART:20260806T235000');
    expect(lines(ics)).toContain('DTEND:20260807T002000');
  });

  it('donne à chaque jour un UID stable, pour qu\'un ré-export remplace', () => {
    const twice = buildStudyIcs([day(), day({ day: '2026-08-07' })], opts)!;
    expect(twice).toContain('UID:benji-plan-2026-08-06@theatre-reader');
    expect(twice).toContain('UID:benji-plan-2026-08-07@theatre-reader');
    expect(buildStudyIcs([day()], opts)).toBe(buildStudyIcs([day()], opts));
  });

  it('résume la journée dans le titre, incipit compris', () => {
    const ics = buildStudyIcs([day({ due: [portion({ id: 'c~d' })] })], opts)!;
    const summary = lines(ics).join('').replace(/ /g, ' ');
    expect(summary).toContain('BENJI');
    expect(summary).toContain('1→4');
    // Compté en tirades (la portion en contient 4), jamais en portions.
    expect(summary).toContain('4 à revoir');
    // C'est l'incipit qui fait reconnaître le passage dans un agenda.
    expect(summary).toContain('Non. Tu peux pas.');
  });

  it('détaille les portions et leur incipit dans la description', () => {
    const ics = buildStudyIcs([day()], opts)!;
    const unfolded = ics.replace(/\r\n /g, '');
    expect(unfolded).toContain('ACTE II. · SCENE I. — tirades 1→4');
    expect(unfolded).toContain('Non. Tu peux pas.');
  });

  it('échappe les caractères réservés, la barre oblique inverse en premier', () => {
    const ics = buildStudyIcs([day()], { ...opts, roleName: 'A;B,C\\D' })!;
    const summary = lines(ics).find((l) => l.startsWith('SUMMARY:'))!;
    expect(summary).toContain('A\\;B\\,C\\\\D');
  });

  it('plie les lignes longues à 75 octets, sans couper un caractère accentué', () => {
    const long = portion({ actLabel: 'ACTE ' + 'É'.repeat(90), sceneLabel: '' });
    const ics = buildStudyIcs([day({ fresh: [long] })], opts)!;
    const enc = new TextEncoder();
    for (const l of lines(ics)) {
      expect(enc.encode(l).length).toBeLessThanOrEqual(75);
    }
    // Les continuations commencent par une espace, et rien n'est perdu.
    expect(ics.replace(/\r\n /g, '')).toContain('É'.repeat(90));
  });

  it('renvoie null plutôt qu\'un calendrier vide', () => {
    expect(buildStudyIcs([], opts)).toBeNull();
  });
});

describe('icsStamp', () => {
  it('rend un horodatage UTC au format attendu', () => {
    expect(icsStamp(new Date(Date.UTC(2026, 7, 5, 17, 0, 0)))).toBe('20260805T170000Z');
  });
});
