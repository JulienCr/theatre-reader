/**
 * État persisté du lecteur mobile (localStorage) et palette de surlignage.
 *
 * Hors de React à dessein : ces valeurs sont lues UNE fois au démarrage, avant
 * le premier rendu, pour que le chrome monte déjà dans le bon état (pas de
 * clignotement « valeurs par défaut puis valeurs réelles »).
 */
import type { ReadingSettings } from '@theatre/audio-player';

export interface PersistedState {
  selected: string[]; // characterId[], l'ordre fixe les couleurs
  fontPct: number; // 100 = base
  reading: ReadingSettings; // réglages de répétition
  myRoles: string[]; // rôles joués (surcharge myCharacterId de l'export)
}

const PALETTE = ['#ffe08a', '#a8e6cf', '#b5d8ff', '#ffc9de', '#d6c8ff', '#ffd6a5'];
export const FONT_MIN = 70;
export const FONT_MAX = 220;

export function colorFor(index: number): string {
  return PALETTE[index % PALETTE.length]!;
}

export const DEFAULT_READING: ReadingSettings = {
  rehearsal: false,
  mask: true,
  playMine: false,
  autoAdvance: false,
  tick: false,
  onlyMyScenes: false,
};

function boolOr(v: unknown, d: boolean): boolean {
  return typeof v === 'boolean' ? v : d;
}

/** `typeof NaN === 'number'` : sans ce garde, un JSON abîmé donne `font-size: NaN%`. */
function numOr(v: unknown, d: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : d;
}

function stringsOr(v: unknown, d: string[]): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : d;
}

export function loadState(key: string, fallback: PersistedState): PersistedState {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedState>;
      const r = (parsed.reading ?? {}) as Partial<ReadingSettings>;
      return {
        selected: stringsOr(parsed.selected, fallback.selected),
        fontPct: numOr(parsed.fontPct, fallback.fontPct),
        reading: {
          rehearsal: boolOr(r.rehearsal, fallback.reading.rehearsal),
          mask: boolOr(r.mask, fallback.reading.mask),
          playMine: boolOr(r.playMine, fallback.reading.playMine),
          autoAdvance: boolOr(r.autoAdvance, fallback.reading.autoAdvance),
          tick: boolOr(r.tick, fallback.reading.tick),
          onlyMyScenes: boolOr(r.onlyMyScenes, fallback.reading.onlyMyScenes),
        },
        myRoles: stringsOr(parsed.myRoles, fallback.myRoles),
      };
    }
  } catch {
    /* localStorage indisponible (mode privé, file://) : on ignore */
  }
  return fallback;
}

export function saveState(key: string, s: PersistedState): void {
  try {
    localStorage.setItem(key, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}
