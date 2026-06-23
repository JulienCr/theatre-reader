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
  buildToc,
  parseFountain,
  renderBody,
  renderCSS,
  type Character,
  type Template,
} from '@theatre/core';

const require = createRequire(import.meta.url);

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
): Promise<{ html: string; filename: string }> {
  const play = parseFountain(fountain, characters);
  const body = renderBody(play, template);
  const css = renderCSS(template);
  const toc = buildToc(play, template).map((e) => ({ id: e.id, label: e.label, scene: e.scene }));
  const title = play.title ?? 'Pièce';
  const slug = slugify(title);

  const data = {
    characters: play.characters.map((c) => ({ id: c.id, name: c.canonicalName })),
    toc,
    highlightsDefault: template.highlights.map((h) => ({
      characterId: h.characterId,
      color: h.color,
    })),
    storageKey: `theatre-reader:${slug}`,
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
