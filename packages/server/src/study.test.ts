import { mkdtempSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { StudyState } from '@theatre/core';

// DATA_DIR est lu à l'import de storage : on fixe l'env AVANT l'import dynamique.
process.env.THEATRE_DATA_DIR = mkdtempSync(join(tmpdir(), 'theatre-study-'));

const { buildServer } = await import('./server');
const { loadStudy } = await import('./storage');
type App = Awaited<ReturnType<typeof buildServer>>;

const sample: StudyState = {
  version: 1,
  config: { roleIds: ['benji'], target: '2026-09-02', sessionMinutes: 25, daysPerWeek: 7 },
  progress: { 'abc#0': { level: 2, due: '2026-08-12', lastSeen: '2026-08-05' } },
};

describe('endpoints study', () => {
  let app: App;
  beforeAll(async () => { app = await buildServer(); });
  afterAll(async () => { await app.close(); });

  it('GET renvoie null quand aucun plan n_existe', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/plays/inconnue/study' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ study: null });
  });

  it('PUT puis GET fait un aller-retour du plan', async () => {
    const put = await app.inject({ method: 'PUT', url: '/api/plays/piece/study', payload: { study: sample } });
    expect(put.statusCode).toBe(200);
    const get = await app.inject({ method: 'GET', url: '/api/plays/piece/study' });
    expect(get.json()).toEqual({ study: sample });
  });

  it('PUT 400 sur un corps qui n_est pas un plan', async () => {
    for (const study of [
      'x',
      null,
      { ...sample, version: 2 },
      { ...sample, config: { ...sample.config, target: '02/09/2026' } },
      { ...sample, config: { ...sample.config, roleIds: [] } },
      { ...sample, config: { ...sample.config, daysPerWeek: 9 } },
    ]) {
      const res = await app.inject({ method: 'PUT', url: '/api/plays/piece/study', payload: { study } });
      expect(res.statusCode).toBe(400);
    }
  });

  it('un PUT refusé ne détruit pas le plan déjà enregistré', async () => {
    await app.inject({ method: 'PUT', url: '/api/plays/piece/study', payload: { study: sample } });
    await app.inject({ method: 'PUT', url: '/api/plays/piece/study', payload: { study: 'x' } });
    const get = await app.inject({ method: 'GET', url: '/api/plays/piece/study' });
    expect(get.json()).toEqual({ study: sample });
  });
});

describe('loadStudy (robustesse)', () => {
  it('renvoie null quand le fichier est absent', async () => {
    expect(await loadStudy('vraiment-inconnue')).toBeNull();
  });

  it('relance (au lieu de renvoyer null) si study.json est corrompu', async () => {
    const dir = join(process.env.THEATRE_DATA_DIR!, 'corrompue');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'study.json'), '{ pas du json', 'utf8');
    // Sinon un saveStudy() ultérieur écraserait des semaines de progression.
    await expect(loadStudy('corrompue')).rejects.toThrow();
  });
});
