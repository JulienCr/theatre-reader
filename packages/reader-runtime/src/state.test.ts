/**
 * L'état du lecteur est relu depuis un localStorage qu'on ne contrôle pas : il a
 * pu être écrit par une version plus ancienne de l'app, ou abîmé. Ces tests
 * fixent le contrat de `loadState` — jamais d'exception, jamais de valeur
 * incohérente rendue au chrome.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_READING,
  loadRate,
  loadResume,
  loadState,
  saveRate,
  saveState,
  type PersistedState,
} from './state';

const KEY = 'theatre-reader:une-piece';

const FALLBACK: PersistedState = {
  selected: [],
  fontPct: 100,
  reading: { ...DEFAULT_READING },
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

  /**
   * `selected` (surlignage) et `myRoles` (rôles joués) étaient deux listes distinctes.
   * Fusionnées, elles doivent l'être par l'union : perdre un rôle casserait la
   * répétition sans un mot, alors qu'un surlignage en trop se décoche.
   */
  describe('fusion des anciennes listes', () => {
    it('unit les rôles aux surlignés, sans doublon et en gardant l’ordre des couleurs', () => {
      store.set(KEY, JSON.stringify({ selected: ['benji', 'michel'], myRoles: ['michel', 'anna'] }));
      expect(loadState(KEY, FALLBACK).selected).toEqual(['benji', 'michel', 'anna']);
    });

    it('rend les rôles seuls quand rien n’était surligné', () => {
      store.set(KEY, JSON.stringify({ selected: [], myRoles: ['michel'] }));
      expect(loadState(KEY, FALLBACK).selected).toEqual(['michel']);
    });

    /* La migration ne doit jouer qu'UNE fois : sinon décocher un personnage le verrait
       revenir au prochain démarrage, ressuscité par un `myRoles` resté en place. */
    it('efface l’ancienne clé dès la première écriture', () => {
      store.set(KEY, JSON.stringify({ selected: ['benji'], myRoles: ['michel'] }));
      const migrated = loadState(KEY, FALLBACK);
      saveState(KEY, { ...migrated, selected: ['benji'] });
      expect(JSON.parse(store.get(KEY)!)).not.toHaveProperty('myRoles');
      expect(loadState(KEY, FALLBACK).selected).toEqual(['benji']);
    });

    it('ignore un myRoles qui n’est pas une liste de textes', () => {
      store.set(KEY, JSON.stringify({ selected: ['benji'], myRoles: 'michel' }));
      expect(loadState(KEY, FALLBACK).selected).toEqual(['benji']);
    });
  });
});

/**
 * La vitesse vit hors de `PersistedState` : elle est globale à toutes les pièces.
 * Une valeur hors cycle rendrait le libellé du bouton incohérent avec ce qu'on entend.
 */
describe('loadRate', () => {
  beforeEach(() => {
    installStorage();
  });

  it('vaut 1 tant que rien n’a été choisi', () => {
    expect(loadRate()).toBe(1);
  });

  it('relit la vitesse enregistrée', () => {
    saveRate(1.5);
    expect(loadRate()).toBe(1.5);
  });

  it('retombe sur 1 pour une valeur hors du cycle', () => {
    saveRate(3);
    expect(loadRate()).toBe(1);
  });

  it('ne jette pas sur une valeur illisible', () => {
    saveRate(Number.NaN);
    expect(loadRate()).toBe(1);
  });
});

/**
 * L'accueil de l'app appelle `loadResume` pour CHAQUE pièce du téléphone, à
 * chaque affichage de la liste. Une exception y coûterait l'écran entier, pas
 * seulement la ligne fautive : le contrat est donc « jamais d'exception,
 * `undefined` en cas de doute », et il se vérifie séparément de `loadState`
 * puisque c'est ce chemin-là, plus court, que l'accueil emprunte.
 */
describe('loadResume', () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = installStorage();
  });

  it('rend undefined quand la pièce n’a jamais été ouverte', () => {
    expect(loadResume(KEY)).toBeUndefined();
  });

  it('rend le point de reprise écrit par le lecteur', () => {
    saveState(KEY, { ...FALLBACK, resume: { sceneId: 'h-42', label: 'ACTE II, scène 3', at: 17 } });
    expect(loadResume(KEY)).toEqual({ sceneId: 'h-42', label: 'ACTE II, scène 3', at: 17 });
  });

  it('rend undefined pour un état sans reprise', () => {
    saveState(KEY, FALLBACK);
    expect(loadResume(KEY)).toBeUndefined();
  });

  it('ne jette pas sur un JSON illisible', () => {
    store.set(KEY, '{ ceci n’est pas du JSON');
    expect(loadResume(KEY)).toBeUndefined();
  });

  it('ignore une reprise sans identifiant de scène', () => {
    store.set(KEY, JSON.stringify({ resume: { label: 'ACTE II', at: 17 } }));
    expect(loadResume(KEY)).toBeUndefined();
  });

  /** Le pire que produise une date perdue est un « il y a longtemps », pas une ligne vide. */
  it('remplace une date illisible par 0 plutôt que de jeter la reprise', () => {
    store.set(KEY, JSON.stringify({ resume: { sceneId: 'h-1', label: 'ACTE I', at: 'hier' } }));
    expect(loadResume(KEY)).toEqual({ sceneId: 'h-1', label: 'ACTE I', at: 0 });
  });
});
