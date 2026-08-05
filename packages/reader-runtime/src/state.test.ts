/**
 * L'état du lecteur est relu depuis un localStorage qu'on ne contrôle pas : il a
 * pu être écrit par une version plus ancienne de l'app, ou abîmé. Ces tests
 * fixent le contrat de `loadState` — jamais d'exception, jamais de valeur
 * incohérente rendue au chrome.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_READING, loadState, saveState, type PersistedState } from './state';

const KEY = 'theatre-reader:une-piece';

const FALLBACK: PersistedState = {
  selected: [],
  fontPct: 100,
  reading: { ...DEFAULT_READING },
  myRoles: [],
};

/** localStorage minimal : `state.ts` n'en utilise que get et set. */
function installStorage(): Map<string, string> {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
  return store;
}

describe('loadState', () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = installStorage();
  });

  it('rend le repli quand rien n’a été écrit', () => {
    expect(loadState(KEY, FALLBACK)).toEqual(FALLBACK);
  });

  it('conserve la position de lecture écrite par une session précédente', () => {
    saveState(KEY, { ...FALLBACK, resume: { sceneId: 'h-42', label: 'ACTE II, scène 3', at: 17 } });
    expect(loadState(KEY, FALLBACK).resume).toEqual({
      sceneId: 'h-42',
      label: 'ACTE II, scène 3',
      at: 17,
    });
  });

  it('ignore une position sans identifiant de scène', () => {
    store.set(KEY, JSON.stringify({ ...FALLBACK, resume: { label: 'ACTE II', at: 17 } }));
    expect(loadState(KEY, FALLBACK).resume).toBeUndefined();
  });

  it('ignore une position dont le libellé n’est pas du texte', () => {
    store.set(KEY, JSON.stringify({ ...FALLBACK, resume: { sceneId: 'h-1', label: 3, at: 17 } }));
    expect(loadState(KEY, FALLBACK).resume).toBeUndefined();
  });

  /** Une pièce ouverte avant cette fonctionnalité n'a pas de `resume` : c'est normal. */
  it('accepte un état écrit avant l’existence de la reprise', () => {
    store.set(KEY, JSON.stringify({ selected: ['a'], fontPct: 120 }));
    const state = loadState(KEY, FALLBACK);
    expect(state.resume).toBeUndefined();
    expect(state.fontPct).toBe(120);
  });

  it('ne jette pas sur un JSON illisible', () => {
    store.set(KEY, '{ ceci n’est pas du JSON');
    expect(loadState(KEY, FALLBACK)).toEqual(FALLBACK);
  });
});
