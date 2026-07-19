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

// Les clés réelles sont des SHA-1 hexadécimaux (40 caractères) : les fixtures aussi.
const KEY_PRESENT = '0123456789abcdef0123456789abcdef01234567';
const KEY_ABSENT = 'fedcba9876543210fedcba9876543210fedcba98';
const KEY_AUTRE_PIECE = 'aaaabbbbccccddddeeeeffff00001111222233334';

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildServer();
});

describe('GET /api/plays/:slug/audio/:key', () => {
  it('sert un clip en cache en audio/mpeg', async () => {
    const bytes = Buffer.from('FAKE-MP3-abc');
    await writeAudioCache('piece', KEY_PRESENT, bytes);
    const res = await app.inject({ method: 'GET', url: `/api/plays/piece/audio/${KEY_PRESENT}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('audio/mpeg');
    expect(res.rawPayload.equals(bytes)).toBe(true);
  });

  it('404 si le clip est absent', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/plays/piece/audio/${KEY_ABSENT}` });
    expect(res.statusCode).toBe(404);
  });

  it("400 sur une traversée de chemin encodée, sans servir l'audio visé", async () => {
    const secret = Buffer.from('FAKE-MP3-autre-piece');
    await writeAudioCache('autre-piece', KEY_AUTRE_PIECE, secret);
    const res = await app.inject({
      method: 'GET',
      url: `/api/plays/piece/audio/..%2F..%2Fautre-piece%2Faudio%2F${KEY_AUTRE_PIECE}`,
    });
    expect(res.statusCode).toBe(400);
    expect(res.headers['content-type']).not.toContain('audio/mpeg');
    expect(res.rawPayload.includes(secret)).toBe(false);
  });

  it('400 sur une clé de forme invalide', async () => {
    for (const key of ['abc', 'ZZZZ', `${KEY_PRESENT}0`, 'g'.repeat(40)]) {
      const res = await app.inject({ method: 'GET', url: `/api/plays/piece/audio/${key}` });
      expect(res.statusCode, `clé « ${key} »`).toBe(400);
    }
  });
});
