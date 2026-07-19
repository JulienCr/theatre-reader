import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, beforeAll } from 'vitest';
import type { FastifyInstance } from 'fastify';

// DATA_DIR (storage) est mémoïsé à l'import : on fixe le dossier temporaire AVANT les imports.
const DATA_DIR = mkdtempSync(join(tmpdir(), 'theatre-audio-manifest-'));
process.env.THEATRE_DATA_DIR = DATA_DIR;

const { buildServer } = await import('./server');
const { writeAudioCache, audioCacheKey } = await import('./storage');
const { DEFAULT_TTS_MODEL, DEFAULT_OUTPUT_FORMAT } = await import('./tts');

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildServer();
});

const url = '/api/plays/piece/audio/manifest';

describe('POST /api/plays/:slug/audio/manifest', () => {
  it('rend les clés du cache et marque celles déjà présentes', async () => {
    const present = audioCacheKey(DEFAULT_TTS_MODEL, 'voix-1', DEFAULT_OUTPUT_FORMAT, null, 'bonjour');
    await writeAudioCache('piece', present, Buffer.from('FAKE-MP3'));

    const res = await app.inject({
      method: 'POST',
      url,
      payload: {
        items: [
          { nodeId: 'n1', voiceId: 'voix-1', text: 'bonjour' },
          { nodeId: 'n2', voiceId: 'voix-1', text: 'jamais synthétisé' },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const { manifest } = res.json() as {
      manifest: Record<string, { key: string; cached: boolean }>;
    };
    expect(manifest.n1).toEqual({ key: present, cached: true });
    expect(manifest.n2!.cached).toBe(false);
  });

  it("répond 200 sans clé ElevenLabs, là où /tts/batch abandonne en 503", async () => {
    // C'est la raison d'être de l'endpoint : préparer un téléphone hors-ligne ne
    // doit rien synthétiser, donc ne doit pas exiger de clé (ni pouvoir facturer).
    const prev = process.env.ELEVENLABS_API_KEY;
    delete process.env.ELEVENLABS_API_KEY;
    const payload = { items: [{ nodeId: 'n1', voiceId: 'voix-1', text: 'bonjour' }] };
    try {
      const manifestRes = await app.inject({ method: 'POST', url, payload });
      const batchRes = await app.inject({
        method: 'POST',
        url: '/api/plays/piece/tts/batch',
        payload,
      });
      expect(manifestRes.statusCode).toBe(200);
      expect(batchRes.statusCode).toBe(503);
    } finally {
      if (prev !== undefined) process.env.ELEVENLABS_API_KEY = prev;
    }
  });

  it('400 si items manque', async () => {
    const res = await app.inject({ method: 'POST', url, payload: {} });
    expect(res.statusCode).toBe(400);
  });
});
