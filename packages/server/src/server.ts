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
import {
  actorReadingTemplate,
  cloneTemplate,
  type AudioConfig,
  type Note,
  type VoiceSettings,
} from '@theatre/core';
import { importPdf } from '@theatre/import';
import { exportPdf } from './export';
import { createLogger, formatRequestLine } from './logger';
import { exportReaderHtml } from './reader-export';
import {
  listPlays,
  loadNotes,
  loadPlay,
  savePlay,
  saveNotes,
  uniqueSlug,
  audioCacheKey,
  readAudioCache,
  writeAudioCache,
  PlayMeta,
} from './storage';
import {
  hasElevenLabsKey,
  listVoices,
  synthesize,
  ttsErrorMessage,
  DEFAULT_TTS_MODEL,
  DEFAULT_OUTPUT_FORMAT,
} from './tts';

interface SavBody {
  fountain: string;
  meta: PlayMeta;
}

interface ExportBody {
  fountain: string;
  characters: PlayMeta['characters'];
  template: PlayMeta['template'];
  notes?: Note[];
  // Export lecteur mobile : audio embarqué (opt-in).
  slug?: string;
  audio?: AudioConfig;
  includeAudio?: boolean;
  bitrate?: string;
  roles?: 'all' | 'others';
}

interface TtsBody {
  text: string;
  voiceId: string;
  model?: string;
  settings?: VoiceSettings;
}

interface TtsBatchBody {
  items: { nodeId: string; text: string; voiceId: string }[];
  model?: string;
  settings?: VoiceSettings;
}

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: createLogger(),
    // Le couple « incoming request » / « request completed » de Fastify est
    // remplacé par une seule ligne compacte (hook onResponse ci-dessous).
    disableRequestLogging: true,
    bodyLimit: 25 * 1024 * 1024,
  });

  app.addHook('onResponse', async (req, reply) => {
    const line = formatRequestLine(
      req.method,
      req.url,
      reply.statusCode,
      reply.elapsedTime,
    );
    // Les requêtes hors /api (front buildé, favicon…) ne sont que du bruit :
    // visibles seulement en THEATRE_LOG_LEVEL=debug, sauf si elles échouent.
    if (req.url.startsWith('/api/') || reply.statusCode >= 400) app.log.info(line);
    else app.log.debug(line);
  });

  // `disableRequestLogging` coupe aussi le log d'erreur intégré de Fastify : on
  // le rétablit ici pour garder la pile d'exception des routes qui échouent.
  app.addHook('onError', async (req, _reply, err) => {
    app.log.error({ err }, `${req.method} ${req.url}`);
  });

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

  app.get<{ Params: { slug: string } }>('/api/plays/:slug/notes', async (req) => ({
    notes: await loadNotes(req.params.slug),
  }));

  app.put<{ Params: { slug: string }; Body: { notes: Note[] } }>(
    '/api/plays/:slug/notes',
    async (req, reply) => {
      const { notes } = req.body;
      if (!Array.isArray(notes)) return reply.code(400).send({ error: 'notes (tableau) requis' });
      await saveNotes(req.params.slug, notes);
      return { ok: true };
    },
  );

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
    const { fountain, characters, template, notes, slug, audio, includeAudio, bitrate, roles } =
      req.body;
    if (typeof fountain !== 'string' || !template) {
      return reply.code(400).send({ error: 'fountain et template requis' });
    }
    let result;
    try {
      result = await exportReaderHtml(fountain, characters ?? [], template, notes ?? [], {
        audio,
        slug,
        includeAudio,
        bitrate,
        roles,
      });
    } catch (e) {
      return reply.code(502).send({ error: ttsErrorMessage(e) });
    }
    return reply
      .type('text/html; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${result.filename}"`)
      .send(result.html);
  });

  // ---- Synthèse vocale ElevenLabs (clé côté serveur uniquement) ----

  app.get('/api/voices', async (_req, reply) => {
    if (!hasElevenLabsKey()) return reply.code(503).send({ error: 'ELEVENLABS_API_KEY absente' });
    try {
      return { voices: await listVoices() };
    } catch (e) {
      return reply.code(502).send({ error: ttsErrorMessage(e) });
    }
  });

  app.post<{ Params: { slug: string }; Body: TtsBody }>(
    '/api/plays/:slug/tts',
    async (req, reply) => {
      if (!hasElevenLabsKey()) return reply.code(503).send({ error: 'ELEVENLABS_API_KEY absente' });
      const { text, voiceId, model, settings } = req.body;
      if (typeof text !== 'string' || !text.trim() || typeof voiceId !== 'string' || !voiceId) {
        return reply.code(400).send({ error: 'text et voiceId requis' });
      }
      const mdl = model ?? DEFAULT_TTS_MODEL;
      const key = audioCacheKey(mdl, voiceId, DEFAULT_OUTPUT_FORMAT, settings ?? null, text);
      let buf = await readAudioCache(req.params.slug, key);
      if (!buf) {
        try {
          buf = await synthesize({ text, voiceId, model: mdl, settings });
        } catch (e) {
          return reply.code(502).send({ error: ttsErrorMessage(e) });
        }
        await writeAudioCache(req.params.slug, key, buf);
      }
      return reply.type('audio/mpeg').header('Cache-Control', 'no-cache').send(buf);
    },
  );

  // Pré-génération (chauffe le cache disque) : rend un manifeste nodeId -> clé.
  app.post<{ Params: { slug: string }; Body: TtsBatchBody }>(
    '/api/plays/:slug/tts/batch',
    async (req, reply) => {
      if (!hasElevenLabsKey()) return reply.code(503).send({ error: 'ELEVENLABS_API_KEY absente' });
      const { items, model, settings } = req.body;
      if (!Array.isArray(items)) return reply.code(400).send({ error: 'items (tableau) requis' });
      const mdl = model ?? DEFAULT_TTS_MODEL;
      const manifest: Record<string, { key: string; cached: boolean }> = {};
      let characters = 0;
      let cursor = 0;
      const worker = async (): Promise<void> => {
        while (cursor < items.length) {
          const item = items[cursor++];
          if (!item || !item.text?.trim() || !item.voiceId) continue;
          const key = audioCacheKey(mdl, item.voiceId, DEFAULT_OUTPUT_FORMAT, settings ?? null, item.text);
          let buf = await readAudioCache(req.params.slug, key);
          let cached = true;
          if (!buf) {
            cached = false;
            buf = await synthesize({ text: item.text, voiceId: item.voiceId, model: mdl, settings });
            await writeAudioCache(req.params.slug, key, buf);
            characters += item.text.length;
          }
          manifest[item.nodeId] = { key, cached };
        }
      };
      try {
        // Concurrence limitée pour ménager les quotas ElevenLabs (429).
        await Promise.all([worker(), worker(), worker()]);
      } catch (e) {
        return reply.code(502).send({ error: ttsErrorMessage(e) });
      }
      return { manifest, characters };
    },
  );

  // Lecture seule du cache disque, par clé (hash de contenu) : cachable et consommable
  // directement comme URL par le lecteur mobile. Pas de synthèse ici (GET idempotent).
  app.get<{ Params: { slug: string; key: string } }>(
    '/api/plays/:slug/audio/:key',
    async (req, reply) => {
      const buf = await readAudioCache(req.params.slug, req.params.key);
      if (!buf) return reply.code(404).send({ error: 'clip absent' });
      return reply
        .type('audio/mpeg')
        .header('Cache-Control', 'public, max-age=31536000, immutable')
        .send(buf);
    },
  );

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
