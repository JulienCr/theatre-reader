/**
 * Serveur local Fastify : import PDF, lecture/écriture des pièces, export PDF.
 * Sert aussi le front buildé (packages/web/dist) si présent — en dev, le front
 * tourne sous Vite avec un proxy /api.
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fastify, { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { actorReadingTemplate, cloneTemplate } from '@theatre/core';
import { importPdf } from '@theatre/import';
import { exportPdf } from './export';
import { exportReaderHtml } from './reader-export';
import { listPlays, loadPlay, savePlay, uniqueSlug, PlayMeta } from './storage';

interface SavBody {
  fountain: string;
  meta: PlayMeta;
}

interface ExportBody {
  fountain: string;
  characters: PlayMeta['characters'];
  template: PlayMeta['template'];
}

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: true, bodyLimit: 25 * 1024 * 1024 });
  await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });

  app.get('/api/plays', async () => ({ plays: await listPlays() }));

  app.get<{ Params: { slug: string } }>('/api/plays/:slug', async (req, reply) => {
    const found = await loadPlay(req.params.slug);
    if (!found) return reply.code(404).send({ error: 'introuvable' });
    return found;
  });

  app.put<{ Params: { slug: string }; Body: SavBody }>('/api/plays/:slug', async (req, reply) => {
    const { fountain, meta } = req.body;
    if (typeof fountain !== 'string' || !meta) {
      return reply.code(400).send({ error: 'fountain et meta requis' });
    }
    await savePlay(req.params.slug, fountain, meta);
    return { ok: true };
  });

  app.post('/api/import', async (req, reply) => {
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: 'fichier PDF requis' });
    const buffer = await file.toBuffer();
    const result = await importPdf(new Uint8Array(buffer));
    const name = result.play.title ?? file.filename.replace(/\.pdf$/i, '');
    const slug = await uniqueSlug(name);
    const meta: PlayMeta = {
      name,
      characters: result.play.characters,
      template: cloneTemplate(actorReadingTemplate),
    };
    await savePlay(slug, result.fountain, meta);
    return {
      slug,
      fountain: result.fountain,
      meta,
      usedLlm: result.usedLlm,
      characterCount: result.characterCount,
    };
  });

  app.post<{ Body: ExportBody }>('/api/export', async (req, reply) => {
    const { fountain, characters, template } = req.body;
    if (typeof fountain !== 'string' || !template) {
      return reply.code(400).send({ error: 'fountain et template requis' });
    }
    const pdf = await exportPdf(fountain, characters ?? [], template);
    return reply
      .type('application/pdf')
      .header('Content-Disposition', 'inline; filename="piece.pdf"')
      .send(pdf);
  });

  app.post<{ Body: ExportBody }>('/api/export/reader', async (req, reply) => {
    const { fountain, characters, template } = req.body;
    if (typeof fountain !== 'string' || !template) {
      return reply.code(400).send({ error: 'fountain et template requis' });
    }
    const { html, filename } = await exportReaderHtml(fountain, characters ?? [], template);
    return reply
      .type('text/html; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(html);
  });

  // Front statique (production). En dev, Vite sert le front et proxifie /api.
  const webDist = fileURLToPath(new URL('../../web/dist/', import.meta.url));
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api')) return reply.code(404).send({ error: 'not found' });
      return reply.sendFile('index.html');
    });
  }

  return app;
}
