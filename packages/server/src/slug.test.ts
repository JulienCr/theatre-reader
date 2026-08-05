/**
 * Le paramètre `:slug` nomme un dossier de `data/`. Fastify le décode avant le
 * handler : sans garde, `..%2F..%2Fx` sortait de `data/` au premier `join` — en
 * écriture comme en lecture. Ces tests couvrent les deux lignes de défense : le
 * hook `onRequest` (400) et `playDir` dans storage.ts.
 */
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// DATA_DIR est lu à l'import de storage : on fixe l'env AVANT l'import dynamique.
const DATA = mkdtempSync(join(tmpdir(), 'theatre-slug-'));
process.env.THEATRE_DATA_DIR = DATA;

const { buildServer } = await import('./server');
const { savePlay, saveNotes, loadPlay, readAudioCache } = await import('./storage');
type App = Awaited<ReturnType<typeof buildServer>>;

/**
 * Cible d'évasion, sous la forme encodée qui arriverait sur le réseau.
 *
 * Le nom porte le pid : un dossier temporaire est partagé par tout ce qui
 * tourne sur la machine, et vérifier l'absence d'un nom courant y confondrait
 * un voisin avec une évasion (ou l'inverse). `CIBLE_PATH` est le chemin que le
 * `join` de storage.ts produirait exactement — c'est lui qu'on surveille, pas
 * le contenu d'un dossier deviné.
 */
const CIBLE = `evade-${process.pid}`;
const ESCAPE = `..%2F..%2F${CIBLE}`;
const CIBLE_PATH = resolve(DATA, '..', '..', CIBLE);

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

  it("n'écrit rien à l'emplacement que l'évasion visait", async () => {
    // Les PUT ci-dessus sont passés par toutes les routes qui écrivent. Si l'une
    // d'elles avait laissé filer le slug, le dossier existerait maintenant.
    expect(existsSync(CIBLE_PATH)).toBe(false);
    // Et le cas à un seul niveau, qui vise le dossier parent immédiat.
    const voisin = resolve(DATA, '..', `${CIBLE}-voisin`);
    const res = await app.inject({
      method: 'PUT',
      url: `/api/plays/..%2F${CIBLE}-voisin/notes`,
      payload: { notes: [] },
    });
    expect(res.statusCode).toBe(400);
    expect(existsSync(voisin)).toBe(false);
  });

  it('laisse passer un slug normal', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/api/plays/ma-piece-2/notes',
      payload: { notes: [] },
    });
    expect(put.statusCode).toBe(200);
  });

  // Le hook ne lit que `req.params` : cette route-ci porte son slug dans le corps
  // et serait donc restée le seul passage non gardé.
  it('400 sur le slug du corps de /api/export/reader', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/export/reader',
      payload: { fountain: 'Salut.', template: {}, slug: `../${CIBLE}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'slug invalide' });
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

  // readAudioCache, lui, ne doit PAS confondre « pas le droit d'exister » avec
  // « pas encore généré » : rendu comme absent, un slug invalide (ou un cache
  // illisible) relancerait une synthèse ElevenLabs payante, en silence.
  it('readAudioCache lève sur slug invalide et rend null sur clip absent', async () => {
    await expect(readAudioCache('../evade', 'a'.repeat(40))).rejects.toThrow('slug invalide');
    expect(await readAudioCache('piece-sans-audio', 'b'.repeat(40))).toBeNull();
  });
});
