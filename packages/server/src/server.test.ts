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
