/**
 * État persisté du lecteur mobile (localStorage) et palette de surlignage.
 *
 * Hors de React à dessein : ces valeurs sont lues UNE fois au démarrage, avant
 * le premier rendu, pour que le chrome monte déjà dans le bon état (pas de
 * clignotement « valeurs par défaut puis valeurs réelles »).
 */
import type { ReadingSettings, Tolerance } from '@theatre/audio-player';

/**
 * Où la lecture en était, pour la reprendre depuis l'écran d'accueil de l'app.
 *
 * Le libellé est stocké avec l'identifiant alors qu'il s'en déduit par le
 * sommaire : l'accueil, lui, n'a pas le sommaire — l'avoir lui coûterait de
 * parser chaque pièce du téléphone au seul titre d'écrire une ligne de texte.
 */
export interface ResumePoint {
  /** Id d'en-tête posé par `buildToc` (`h-<index>`), donc utilisable comme ancre. */
  sceneId: string;
  label: string;
  /** Date du passage, en ms — l'accueil en fait un « il y a 2 j ». */
  at: number;
}

/**
 * `selected` est la liste UNIQUE des personnages de l'utilisateur : elle surligne
 * ses répliques *et* définit ses rôles (masquage, pause « c'est à toi », « mes
 * scènes »). Elle a remplacé un couple `selected` / `myRoles` que rien ne reliait —
 * deux listes des mêmes personnages, à cocher deux fois pour un seul propos.
 */
export interface PersistedState {
  selected: string[]; // characterId[], l'ordre fixe les couleurs
  fontPct: number; // 100 = base
  reading: ReadingSettings; // réglages de répétition
  resume?: ResumePoint; // absent tant qu'aucune scène n'a été franchie
}

const PALETTE = ['#ffe08a', '#a8e6cf', '#b5d8ff', '#ffc9de', '#d6c8ff', '#ffd6a5'];
export const FONT_MIN = 70;
export const FONT_MAX = 220;

/** Vitesses de lecture, dans l'ordre du cycle du bouton. */
export const RATES: readonly number[] = [1, 1.5, 2];

/**
 * La vitesse est le rythme de travail de la personne, pas une propriété de la pièce :
 * elle vit donc sous sa propre clé, partagée par toutes les pièces — contrairement à
 * `PersistedState`, indexé par `storageKey`. Cette clé fonctionne aussi dans le .html
 * exporté, qui n'a aucun accès aux réglages de l'app.
 */
const RATE_KEY = 'theatre-reader:rate';

export function loadRate(): number {
  try {
    const r = Number(localStorage.getItem(RATE_KEY));
    // Une valeur hors cycle rendrait le libellé du bouton incohérent avec ce qu'on
    // entend, et le premier appui la remplacerait sans qu'on sache par quoi.
    if (RATES.some((x) => x === r)) return r;
  } catch {
    /* localStorage indisponible (mode privé, file://) : on ignore */
  }
  return 1;
}

export function saveRate(rate: number): void {
  try {
    localStorage.setItem(RATE_KEY, String(rate));
  } catch {
    /* ignore */
  }
}

/**
 * Répétition vocale : réglage GLOBAL, comme la vitesse et pour la même raison —
 * c'est une façon de travailler, pas une propriété d'une pièce. L'issue le demande
 * explicitement « global et persistant ».
 */
const VOICE_KEY = 'theatre-reader:voice';

export interface VoicePrefs {
  enabled: boolean;
  tolerance: Tolerance;
}

/** Souple par défaut : c'est le comportement recommandé par l'issue. */
export const DEFAULT_VOICE: VoicePrefs = { enabled: false, tolerance: 'soft' };

export function loadVoice(): VoicePrefs {
  try {
    const raw = localStorage.getItem(VOICE_KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<VoicePrefs>;
      return {
        enabled: boolOr(v.enabled, DEFAULT_VOICE.enabled),
        // Une valeur inconnue retombe sur « souple » plutôt que d'imposer un mode
        // sévère que personne n'a demandé.
        tolerance: v.tolerance === 'strict' ? 'strict' : 'soft',
      };
    }
  } catch {
    /* localStorage indisponible ou JSON abîmé : on ignore */
  }
  return { ...DEFAULT_VOICE };
}

export function saveVoice(v: VoicePrefs): void {
  try {
    localStorage.setItem(VOICE_KEY, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

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

/**
 * Les deux textes sont exigés ensemble : un point de reprise sans ancre ne mène
 * nulle part, et sans libellé l'accueil afficherait une ligne vide. La date, elle,
 * se remplace par 0 — le pire qu'elle produise est un « il y a longtemps ».
 */
function resumeOr(v: unknown, d: ResumePoint | undefined): ResumePoint | undefined {
  if (typeof v !== 'object' || v === null) return d;
  const r = v as Partial<ResumePoint>;
  if (typeof r.sceneId !== 'string' || typeof r.label !== 'string') return d;
  return { sceneId: r.sceneId, label: r.label, at: numOr(r.at, 0) };
}

/**
 * Le seul point de reprise, pour un hôte qui n'a pas le reste de l'état — l'accueil
 * de l'app, qui n'ouvre pas la pièce et n'a donc ni sommaire ni réglages. La clé
 * se fabrique avec `storageKeyFor` (@theatre/reader-ui).
 */
export function loadResume(key: string): ResumePoint | undefined {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return undefined;
    return resumeOr((JSON.parse(raw) as Partial<PersistedState>).resume, undefined);
  } catch {
    return undefined;
  }
}

/**
 * Reprise d'un état écrit avant la fusion des listes : `myRoles` y vivait à côté de
 * `selected`. On prend l'union — perdre un rôle casserait silencieusement la
 * répétition de quelqu'un, alors qu'un personnage surligné en trop se décoche.
 *
 * Migration à un seul coup : `saveState` sérialise l'objet entier, donc dès la
 * première écriture `myRoles` disparaît du JSON et ne peut plus ressusciter un
 * personnage décoché depuis.
 */
function mergeLegacyRoles(selected: string[], legacy: unknown): string[] {
  const roles = stringsOr(legacy, []);
  return roles.length ? [...selected, ...roles.filter((r) => !selected.includes(r))] : selected;
}

export function loadState(key: string, fallback: PersistedState): PersistedState {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedState> & { myRoles?: unknown };
      const r = (parsed.reading ?? {}) as Partial<ReadingSettings>;
      return {
        selected: mergeLegacyRoles(
          stringsOr(parsed.selected, fallback.selected),
          parsed.myRoles,
        ),
        fontPct: numOr(parsed.fontPct, fallback.fontPct),
        reading: {
          rehearsal: boolOr(r.rehearsal, fallback.reading.rehearsal),
          mask: boolOr(r.mask, fallback.reading.mask),
          playMine: boolOr(r.playMine, fallback.reading.playMine),
          autoAdvance: boolOr(r.autoAdvance, fallback.reading.autoAdvance),
          tick: boolOr(r.tick, fallback.reading.tick),
          onlyMyScenes: boolOr(r.onlyMyScenes, fallback.reading.onlyMyScenes),
        },
        resume: resumeOr(parsed.resume, fallback.resume),
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
