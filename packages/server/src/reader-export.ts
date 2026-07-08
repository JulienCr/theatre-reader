/**
 * Assemblage du lecteur mobile autonome : un seul .html auto-suffisant.
 *
 * Rend la pièce avec le rendu canonique de @theatre/core (renderBody/renderCSS,
 * en flux continu — pas de Paged.js), neutralise les règles de pagination,
 * inline le runtime navigateur (@theatre/reader-runtime, bundlé par esbuild) et
 * un bloc de données JSON. Le fichier s'ouvre hors-ligne dans un navigateur
 * mobile, sans serveur.
 */

import { createRequire } from 'node:module';
import * as esbuild from 'esbuild';
import {
  buildNodeIds,
  buildToc,
  parseFountain,
  renderBody,
  renderCSS,
  speechText,
  type AudioConfig,
  type Character,
  type Note,
  type Template,
} from '@theatre/core';
import { DEFAULT_TTS_MODEL, hasElevenLabsKey, synthesize } from './tts';
import { audioCacheKey, readAudioCache, writeAudioCache } from './storage';

const require = createRequire(import.meta.url);

export interface ExportAudioOptions {
  audio?: AudioConfig;
  /** Slug de la pièce (pour réutiliser le cache disque). */
  slug?: string;
  includeAudio?: boolean;
  /** Format ElevenLabs (défaut 'mp3_44100_64' — fichier plus léger). */
  bitrate?: string;
  /** 'all' = tous les rôles, 'others' = tout sauf mon rôle (défaut). */
  roles?: 'all' | 'others';
}

/** Pré-génère (cache-first) les MP3 des tirades et les embarque en data URI. */
async function buildAudioClips(
  fountain: string,
  characters: Character[],
  fallbackSlug: string,
  opts: ExportAudioOptions,
): Promise<{ clips: Record<string, string>; myCharacterId?: string } | undefined> {
  if (!opts.includeAudio || !opts.audio?.voices || !hasElevenLabsKey()) return undefined;
  const play = parseFountain(fountain, characters);
  const ids = buildNodeIds(play);
  const model = opts.audio.model ?? DEFAULT_TTS_MODEL;
  const bitrate = opts.bitrate ?? 'mp3_44100_64';
  const roles = opts.roles ?? 'others';
  const settings = opts.audio.settings;
  const myId = opts.audio.myCharacterId;
  const slug = opts.slug ?? fallbackSlug;

  const tasks: { nodeId: string; voiceId: string; text: string }[] = [];
  play.nodes.forEach((node, i) => {
    if (node.type !== 'line') return;
    if (roles === 'others' && myId && node.characterId === myId) return;
    const voiceId = opts.audio!.voices![node.characterId];
    if (!voiceId) return;
    const text = speechText(node);
    if (text) tasks.push({ nodeId: ids[i]!, voiceId, text });
  });

  const clips: Record<string, string> = {};
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < tasks.length) {
      const t = tasks[cursor++];
      if (!t) continue;
      const key = audioCacheKey(model, t.voiceId, bitrate, settings ?? null, t.text);
      let buf = await readAudioCache(slug, key);
      if (!buf) {
        buf = await synthesize({ text: t.text, voiceId: t.voiceId, model, outputFormat: bitrate, settings });
        await writeAudioCache(slug, key, buf);
      }
      clips[t.nodeId] = `data:audio/mpeg;base64,${buf.toString('base64')}`;
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return { clips, myCharacterId: myId };
}

let runtimeCache: string | null = null;
async function readerRuntime(): Promise<string> {
  if (runtimeCache === null) {
    const entry = require.resolve('@theatre/reader-runtime');
    const out = await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      format: 'iife',
      globalName: 'TheatreReader',
      minify: true,
      write: false,
      platform: 'browser',
      target: 'es2018',
    });
    runtimeCache = out.outputFiles[0]!.text;
  }
  return runtimeCache;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function slugify(s: string): string {
  const base = s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'piece';
}

export async function exportReaderHtml(
  fountain: string,
  characters: Character[],
  template: Template,
  notes: Note[] = [],
  audioOpts: ExportAudioOptions = {},
): Promise<{ html: string; filename: string }> {
  const play = parseFountain(fountain, characters);
  const body = renderBody(play, template);
  const css = renderCSS(template);
  const toc = buildToc(play, template).map((e) => ({ id: e.id, label: e.label, scene: e.scene }));
  const title = play.title ?? 'Pièce';
  const slug = slugify(title);

  const audio = await buildAudioClips(fountain, characters, slug, audioOpts);

  const data = {
    characters: play.characters.map((c) => ({ id: c.id, name: c.canonicalName })),
    toc,
    highlightsDefault: template.highlights.map((h) => ({
      characterId: h.characterId,
      color: h.color,
    })),
    notes,
    storageKey: `theatre-reader:${slug}`,
    ...(audio ? { audio } : {}),
  };

  // Échappe </script> et < pour une inclusion sûre dans une balise <script>.
  // Échappe aussi U+2028/2029 (séparateurs de ligne JS interdits bruts dans un string littéral).
  const dataJson = JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const runtime = await readerRuntime();

  const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(title)}</title>
<style>
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { -webkit-text-size-adjust: 100%; padding: 0 16px; }
.play { max-width: none; }
${css}
/* Neutralise la pagination : le fichier mobile est en reflow continu. */
.toc-item a::after { content: none !important; }
.toc, .distribution--break { break-after: auto; }
</style>
</head>
<body>
${body}
<script>window.__THEATRE_READER_DATA__ = ${dataJson};</script>
<script>${runtime}
TheatreReader.boot();</script>
</body>
</html>`;

  return { html, filename: `lecteur-${slug}.html` };
}
