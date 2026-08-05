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
  config: {
    roleIds: ['benji'],
    target: '2026-09-02',
    sessionMinutes: 25,
    daysPerWeek: 7,
    startTime: '19:30',
  },
  progress: { 'abc#0': { level: 2, due: '2026-08-12', lastSeen: '2026-08-05' } },
};

describe('endpoints study', () => {
  let app: App;
  beforeAll(async () => { app = await buildServer(); });
  afterAll(async () => { await app.close(); });

  it('GET renvoie null quand aucun plan n\'existe', async () => {
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

  it('PUT 400 sur un corps qui n\'est pas un plan', async () => {
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

  it('accepte un plan écrit avant l\'heure de séance et lui donne le défaut', async () => {
    const { startTime, ...legacy } = sample.config;
    expect(startTime).toBe('19:30');
    const put = await app.inject({
      method: 'PUT',
      url: '/api/plays/ancienne/study',
      payload: { study: { ...sample, config: legacy } },
    });
    expect(put.statusCode).toBe(200);
    const get = await app.inject({ method: 'GET', url: '/api/plays/ancienne/study' });
    expect(get.json().study.config.startTime).toBe('19:30');
  });

  it('un PUT refusé ne détruit pas le plan déjà enregistré', async () => {
    await app.inject({ method: 'PUT', url: '/api/plays/piece/study', payload: { study: sample } });
    await app.inject({ method: 'PUT', url: '/api/plays/piece/study', payload: { study: 'x' } });
    const get = await app.inject({ method: 'GET', url: '/api/plays/piece/study' });
    expect(get.json()).toEqual({ study: sample });
  });
});

describe('suppression du plan', () => {
  let app: App;
  beforeAll(async () => { app = await buildServer(); });
  afterAll(async () => { await app.close(); });

  it('DELETE efface le plan', async () => {
    await app.inject({ method: 'PUT', url: '/api/plays/jetable/study', payload: { study: sample } });
    const del = await app.inject({ method: 'DELETE', url: '/api/plays/jetable/study' });
    expect(del.statusCode).toBe(200);
    const get = await app.inject({ method: 'GET', url: '/api/plays/jetable/study' });
    expect(get.json()).toEqual({ study: null });
  });

  it('DELETE sur un plan absent réussit quand même', async () => {
    // L'appelant voulait qu'il n'y ait plus de plan : c'est le cas.
    const res = await app.inject({ method: 'DELETE', url: '/api/plays/jamais-vue/study' });
    expect(res.statusCode).toBe(200);
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

  it('relance sur un JSON valide mais structurellement faux', async () => {
    const dir = join(process.env.THEATRE_DATA_DIR!, 'incoherente');
    await mkdir(dir, { recursive: true });
    // Parseable, donc l'ancien cast le renvoyait tel quel : le client recevait
    // un état qu'il ne sait pas interpréter.
    await writeFile(join(dir, 'study.json'), JSON.stringify({ version: 99 }), 'utf8');
    await expect(loadStudy('incoherente')).rejects.toThrow();
  });
});
