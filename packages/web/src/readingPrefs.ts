/**
 * Préférences de lecture par appareil (réglages de répétition + rôles joués).
 *
 * Ces réglages sont propres au lecteur/à l'appareil (pas à la production) : ils
 * vivent dans le localStorage, clé par pièce, et NON dans meta.json (qui est
 * partagé et sauvegardé manuellement côté éditeur).
 */
import type { ReadingSettings } from '@theatre/audio-player';

export interface ReadingPrefs {
  settings: ReadingSettings;
  myRoles: string[];
}

const keyFor = (slug: string): string => `theatre-reader:reading:${slug}`;
const boolOr = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);

export function defaultSettings(): ReadingSettings {
  return { rehearsal: false, mask: true, playMine: false, autoAdvance: false, tick: false };
}

export function loadReadingPrefs(slug: string, fallbackRoles: string[]): ReadingPrefs {
  const fallback: ReadingPrefs = { settings: defaultSettings(), myRoles: fallbackRoles };
  try {
    const raw = localStorage.getItem(keyFor(slug));
    if (!raw) return fallback;
    const p = JSON.parse(raw) as { settings?: Partial<ReadingSettings>; myRoles?: unknown };
    const s = p.settings ?? {};
    return {
      settings: {
        rehearsal: boolOr(s.rehearsal, fallback.settings.rehearsal),
        mask: boolOr(s.mask, fallback.settings.mask),
        playMine: boolOr(s.playMine, fallback.settings.playMine),
        autoAdvance: boolOr(s.autoAdvance, fallback.settings.autoAdvance),
        tick: boolOr(s.tick, fallback.settings.tick),
      },
      myRoles: Array.isArray(p.myRoles)
        ? p.myRoles.filter((x): x is string => typeof x === 'string')
        : fallback.myRoles,
    };
  } catch {
    return fallback;
  }
}

export function saveReadingPrefs(slug: string, prefs: ReadingPrefs): void {
  try {
    localStorage.setItem(keyFor(slug), JSON.stringify(prefs));
  } catch {
    /* localStorage indisponible : on ignore */
  }
}
