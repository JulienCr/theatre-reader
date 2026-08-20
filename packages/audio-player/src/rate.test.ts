/**
 * La vitesse est relue depuis un localStorage qu'on ne contrôle pas — écrit par une
 * version plus ancienne, ou abîmé — et elle est partagée par les deux lecteurs. Ces
 * tests fixent les deux contrats qui les tiennent ensemble : jamais d'exception, et
 * jamais une valeur hors du cycle (le libellé du bouton mentirait sur ce qu'on entend).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { loadRate, nextRate, RATES, saveRate } from './rate';

/** localStorage minimal : `rate.ts` n'en utilise que get et set. */
function installStorage(): Map<string, string> {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
  return store;
}

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

  /* Le lecteur web tourne dans un onglet ordinaire, le .html exporté sous file:// où
     l'accès peut lever. Les deux appellent `loadRate` avant le premier rendu. */
  it('ne jette pas quand localStorage est indisponible', () => {
    (globalThis as { localStorage?: unknown }).localStorage = undefined;
    expect(loadRate()).toBe(1);
    expect(() => saveRate(2)).not.toThrow();
  });
});

describe('nextRate', () => {
  it('parcourt le cycle puis revient au début', () => {
    const seen = [1];
    for (let i = 0; i < RATES.length; i++) seen.push(nextRate(seen[seen.length - 1]!));
    expect(seen).toEqual([1, 1.5, 2, 1]);
  });

  it('repart du début depuis une valeur inconnue', () => {
    expect(nextRate(1.25)).toBe(1);
  });
});
