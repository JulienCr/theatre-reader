import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, beforeAll } from 'vitest';
import type { FastifyInstance } from 'fastify';

// DATA_DIR (storage) est mémoïsé à l'import : on fixe le dossier temporaire AVANT les imports.
const DATA_DIR = mkdtempSync(join(tmpdir(), 'theatre-audio-get-'));
process.env.THEATRE_DATA_DIR = DATA_DIR;

const { buildServer } = await import('./server');
const { writeAudioCache } = await import('./storage');

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildServer();
});

describe('GET /api/plays/:slug/audio/:key', () => {
  it('sert un clip en cache en audio/mpeg', async () => {
    const bytes = Buffer.from('FAKE-MP3-abc');
    await writeAudioCache('piece', 'deadbeef', bytes);
    const res = await app.inject({ method: 'GET', url: '/api/plays/piece/audio/deadbeef' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('audio/mpeg');
    expect(res.rawPayload.equals(bytes)).toBe(true);
  });

  it('404 si le clip est absent', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/plays/piece/audio/manquant' });
    expect(res.statusCode).toBe(404);
  });
});
