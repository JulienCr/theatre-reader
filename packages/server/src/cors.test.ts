import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, beforeAll } from 'vitest';
import type { FastifyInstance } from 'fastify';

// DATA_DIR (storage) est mémoïsé à l'import : on fixe le dossier temporaire AVANT les imports.
const DATA_DIR = mkdtempSync(join(tmpdir(), 'theatre-cors-'));
process.env.THEATRE_DATA_DIR = DATA_DIR;

const { buildServer } = await import('./server');

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildServer();
});

describe('CORS en liste blanche', () => {
  it('autorise la WebView Capacitor', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/plays',
      headers: { origin: 'capacitor://localhost' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('capacitor://localhost');
  });

  it('autorise le vite preview de l’app mobile', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/plays',
      headers: { origin: 'http://localhost:4173' },
    });
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:4173');
  });

  it('répond au préflight OPTIONS avec les méthodes attendues', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/api/plays/piece',
      headers: {
        origin: 'capacitor://localhost',
        'access-control-request-method': 'PUT',
      },
    });
    expect(res.headers['access-control-allow-origin']).toBe('capacitor://localhost');
    expect(res.headers['access-control-allow-methods']).toContain('PUT');
  });

  it('n’expose rien à une origine hors liste blanche', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/plays',
      headers: { origin: 'https://evil.example' },
    });
    // Sans en-tête, le navigateur bloque la lecture de la réponse côté page tierce.
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('laisse passer les appels sans en-tête Origin (curl, tests)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/plays' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('plays');
  });
});
