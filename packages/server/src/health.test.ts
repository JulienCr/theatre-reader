import { mkdtempSync } from 'node:fs';
import os, { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, beforeAll } from 'vitest';
import type { FastifyInstance } from 'fastify';

// DATA_DIR (storage) est mémoïsé à l'import : on fixe le dossier temporaire AVANT les imports.
const DATA_DIR = mkdtempSync(join(tmpdir(), 'theatre-health-'));
process.env.THEATRE_DATA_DIR = DATA_DIR;

const { buildServer } = await import('./server');

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildServer();
});

describe('GET /api/health', () => {
  it('porte le marqueur qui identifie une instance Theatre Reader', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    // C'est sur ce champ, et pas sur le code 200, que la découverte de l'app mobile
    // décide qu'elle parle bien au Mac : le contrat doit rester stable.
    expect(res.json()).toMatchObject({ app: 'theatre-reader', host: os.hostname(), plays: 0 });
  });

  it('est joignable depuis la WebView Capacitor', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { origin: 'capacitor://localhost' },
    });
    expect(res.headers['access-control-allow-origin']).toBe('capacitor://localhost');
  });
});
