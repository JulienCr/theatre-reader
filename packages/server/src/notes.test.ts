import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Note } from '@theatre/core';

// DATA_DIR est lu à l'import de storage : on fixe l'env AVANT l'import dynamique.
process.env.THEATRE_DATA_DIR = mkdtempSync(join(tmpdir(), 'theatre-notes-'));

const { buildServer } = await import('./server');
type App = Awaited<ReturnType<typeof buildServer>>;

const sample: Note[] = [
  { id: 'a', nodeId: 'abc#0', start: 0, end: 7, quote: 'Bonjour', body: 'plus fort', createdAt: '2026-06-23T00:00:00.000Z', updatedAt: '2026-06-23T00:00:00.000Z' },
];

describe('endpoints notes', () => {
  let app: App;
  beforeAll(async () => { app = await buildServer(); });
  afterAll(async () => { await app.close(); });

  it('GET renvoie [] quand aucune note', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/plays/inconnue/notes' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ notes: [] });
  });

  it('PUT puis GET fait un aller-retour des notes', async () => {
    const put = await app.inject({ method: 'PUT', url: '/api/plays/piece/notes', payload: { notes: sample } });
    expect(put.statusCode).toBe(200);
    const get = await app.inject({ method: 'GET', url: '/api/plays/piece/notes' });
    expect(get.json()).toEqual({ notes: sample });
  });

  it('PUT 400 si notes n_est pas un tableau', async () => {
    const res = await app.inject({ method: 'PUT', url: '/api/plays/piece/notes', payload: { notes: 'x' } });
    expect(res.statusCode).toBe(400);
  });
});
