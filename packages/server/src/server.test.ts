import { describe, expect, it } from 'vitest';
import { actorReadingTemplate } from '@theatre/core';
import { buildServer } from './server';

describe('POST /api/export/reader', () => {
  it('renvoie un .html en pièce jointe', async () => {
    const app = await buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/api/export/reader',
      payload: { fountain: `MICHEL\nBonjour.\n`, characters: [], template: actorReadingTemplate },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.body).toContain('<!doctype html>');
    await app.close();
  });

  it('400 si fountain manquant', async () => {
    const app = await buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/api/export/reader',
      payload: { template: actorReadingTemplate },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe('TTS ElevenLabs', () => {
  it('503 sans clé sur GET /api/voices', async () => {
    const prev = process.env.ELEVENLABS_API_KEY;
    delete process.env.ELEVENLABS_API_KEY;
    const app = await buildServer();
    const res = await app.inject({ method: 'GET', url: '/api/voices' });
    expect(res.statusCode).toBe(503);
    await app.close();
    if (prev !== undefined) process.env.ELEVENLABS_API_KEY = prev;
  });

  it('400 si text/voiceId manquants (clé présente)', async () => {
    const prev = process.env.ELEVENLABS_API_KEY;
    process.env.ELEVENLABS_API_KEY = 'test-key';
    const app = await buildServer();
    const res = await app.inject({ method: 'POST', url: '/api/plays/x/tts', payload: {} });
    expect(res.statusCode).toBe(400);
    await app.close();
    if (prev === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = prev;
  });
});
