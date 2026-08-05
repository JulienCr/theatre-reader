/**
 * Le paramètre `:slug` nomme un dossier de `data/`. Fastify le décode avant le
 * handler : sans garde, `..%2F..%2Fx` sortait de `data/` au premier `join` — en
 * écriture comme en lecture. Ces tests couvrent les deux lignes de défense : le
 * hook `onRequest` (400) et `playDir` dans storage.ts.
 */
import { mkdtempSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// DATA_DIR est lu à l'import de storage : on fixe l'env AVANT l'import dynamique.
const DATA = mkdtempSync(join(tmpdir(), 'theatre-slug-'));
process.env.THEATRE_DATA_DIR = DATA;

const { buildServer } = await import('./server');
const { savePlay, saveNotes, loadPlay } = await import('./storage');
type App = Awaited<ReturnType<typeof buildServer>>;

/** Chemin d'évasion sous sa forme encodée, telle qu'elle arriverait sur le réseau. */
const ESCAPE = '..%2F..%2Fevade';

describe('garde du paramètre slug', () => {
  let app: App;
  beforeAll(async () => {
    app = await buildServer();
  });
  afterAll(async () => {
    await app.close();
  });

  const cases: {
    method: 'GET' | 'PUT' | 'POST' | 'DELETE';
    url: string;
    payload?: Record<string, unknown>;
  }[] = [
    { method: 'GET', url: `/api/plays/${ESCAPE}` },
    { method: 'PUT', url: `/api/plays/${ESCAPE}`, payload: { fountain: 'x', meta: { name: 'x' } } },
    { method: 'GET', url: `/api/plays/${ESCAPE}/notes` },
    { method: 'PUT', url: `/api/plays/${ESCAPE}/notes`, payload: { notes: [] } },
    { method: 'GET', url: `/api/plays/${ESCAPE}/study` },
    { method: 'DELETE', url: `/api/plays/${ESCAPE}/study` },
    { method: 'POST', url: `/api/plays/${ESCAPE}/audio/manifest`, payload: { items: [] } },
    { method: 'GET', url: `/api/plays/${ESCAPE}/audio/${'a'.repeat(40)}` },
  ];

  for (const c of cases) {
    it(`400 sur ${c.method} ${c.url}`, async () => {
      const res = await app.inject({ method: c.method, url: c.url, payload: c.payload });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'slug invalide' });
    });
  }

  it("n'écrit rien à côté du dossier de données", async () => {
    const parent = await readdir(dirname(DATA));
    expect(parent).not.toContain('evade');
  });

  it('laisse passer un slug normal', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/api/plays/ma-piece-2/notes',
      payload: { notes: [] },
    });
    expect(put.statusCode).toBe(200);
  });
});

describe('storage refuse les slugs invalides sans passer par le serveur', () => {
  it('savePlay et saveNotes lèvent', async () => {
    const meta = { name: 'x', characters: [], template: {} as never };
    await expect(savePlay('../evade', 'x', meta)).rejects.toThrow('slug invalide');
    await expect(saveNotes('a/b', [])).rejects.toThrow('slug invalide');
  });

  // loadPlay avale toute erreur (une pièce absente n'en est pas une) : le slug
  // invalide y ressort donc en `null`, pas en exception. C'est le hook qui rend le 400.
  it('loadPlay renvoie null', async () => {
    expect(await loadPlay('../evade')).toBeNull();
  });
});
