/**
 * Le transport est injecté : ces tests portent sur l'ordre des candidats et sur la
 * validation de la réponse, pas sur le réseau. La branche `CapacitorHttp` de
 * `defaultProbe`, elle, ne se vérifie que sur un iPhone (c'est elle qui déclenche la
 * demande de permission « réseau local »).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// `settings` lit localStorage à l'appel, pas à l'import : un stub global posé ici
// suffit, l'environnement de test étant `node` (aucun DOM).
const storage = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => void storage.set(k, v),
  removeItem: (k: string) => void storage.delete(k),
  clear: () => storage.clear(),
  key: () => null,
  length: 0,
} as Storage;

const { discover, lanBase, probeBase } = await import('./discovery');
const { getApiBase, setActiveBase, setManualBase } = await import('./settings');

const HEALTH = { app: 'theatre-reader', host: 'MacBook', plays: 3 };
const TAILSCALE = 'https://mac.tailnet.ts.net';

beforeEach(() => {
  storage.clear();
  setActiveBase(null);
});

describe('probeBase', () => {
  it('accepte une réponse portant le marqueur de l’app', async () => {
    expect(await probeBase('http://x', async () => HEALTH)).toBe('MacBook');
  });

  it('rejette un 200 qui n’est pas Theatre Reader', async () => {
    // Portail captif, proxy, autre service sur le port : un 200 ne prouve rien.
    expect(await probeBase('http://x', async () => ({ ok: true }))).toBeNull();
  });

  it('rejette une base vide sans même sonder', async () => {
    const probe = vi.fn();
    expect(await probeBase('', probe)).toBeNull();
    expect(probe).not.toHaveBeenCalled();
  });

  it('rejette un transport en erreur (timeout, Mac éteint)', async () => {
    expect(
      await probeBase('http://x', () => Promise.reject(new Error('timeout'))),
    ).toBeNull();
  });
});

describe('discover', () => {
  it('préfère l’adresse manuelle, qui marche aussi hors du Wi-Fi', async () => {
    setManualBase(TAILSCALE);
    const seen: string[] = [];
    const found = await discover(async (url) => {
      seen.push(url);
      return HEALTH;
    });
    expect(found).toEqual({ base: TAILSCALE, host: 'MacBook', manual: true });
    expect(seen).toEqual([`${TAILSCALE}/api/health`]);
    // Adresse manuelle : rien à surcharger, `getApiBase` la retrouve seule.
    expect(getApiBase()).toBe(TAILSCALE);
  });

  it('bascule sur le réseau local quand le tailnet ne répond pas', async () => {
    setManualBase(TAILSCALE);
    const found = await discover(async (url) =>
      url.startsWith(lanBase) ? HEALTH : Promise.reject(new Error('injoignable')),
    );
    expect(found).toEqual({ base: lanBase, host: 'MacBook', manual: false });
    expect(getApiBase()).toBe(lanBase);
  });

  it('trouve le Mac sans aucune adresse saisie — le cas nominal', async () => {
    const found = await discover(async () => HEALTH);
    expect(found?.base).toBe(lanBase);
    expect(getApiBase()).toBe(lanBase);
  });

  it('remet l’app à zéro quand rien ne répond', async () => {
    setActiveBase(lanBase);
    expect(await discover(() => Promise.reject(new Error('rien')))).toBeNull();
    // Sans cette remise à zéro, les appels suivants viseraient une base morte.
    expect(getApiBase()).toBe('');
  });
});
