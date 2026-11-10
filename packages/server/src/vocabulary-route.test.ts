import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

// DATA_DIR is memoised at import: set it before importing the server.
process.env.THEATRE_DATA_DIR = mkdtempSync(join(tmpdir(), 'theatre-vocabulary-'));
process.env.THEATRE_DISABLE_SPELLCHECK = '1';

const { buildServer } = await import('./server');
const { savePlay } = await import('./storage');

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildServer();
  await savePlay('piece', 'Title: Test\n\n.ACTE I.\n\n@ZOÉ\nBonjour.\n', {
    name: 'Test',
    characters: [{ id: 'zoe', canonicalName: 'ZOÉ', aliases: ['ZOÉ'] }],
  } as never);
});

describe('GET /api/plays/:slug/vocabulary', () => {
  it('returns the vocabulary of the play', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/plays/piece/vocabulary' });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().vocabulary)).toBe(true);
  });

  it('answers 404 for an unknown play', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/plays/nope/vocabulary' });
    expect(res.statusCode).toBe(404);
  });
});
