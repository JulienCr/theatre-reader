# Lecteur mobile Capacitor — Jalon 1 : boucle offline

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Révisé le 2026-07-19, après la refonte UI (`main` → 5bf1241, PR #7/#9/#11/#13/#15).**
> La version initiale prévoyait de servir `Reader.tsx` dans la WebView et de **supprimer**
> `@theatre/reader-runtime`. Ces PR ont fait de `reader-runtime` un véritable lecteur mobile
> React/Preact (chrome, transport, sheet Options, modes de répétition) adossé aux nouveaux
> `@theatre/ui` et `@theatre/reader-ui`. **Décision inversée : on garde et on réutilise
> `reader-runtime`.** `Reader.tsx` reste le lecteur *desktop* (Paged.js = parité PDF) et
> n'est **pas** embarqué sur le téléphone — on n'y expédie ni Paged.js ni l'UI d'édition.

**Goal:** Remplacer l'export HTML autonome par une app iOS Capacitor qui embarque le lecteur mobile existant (`@theatre/reader-runtime`), synchronise texte + notes + audio depuis le Mac (via Tailscale) vers le système de fichiers natif, et permet la répétition 100 % hors-ligne.

**Architecture:** Un paquet dédié léger `@theatre/mobile-app` (Vite + Preact) fait **à l'exécution** ce que `exportReaderHtml` fait au build : `renderBody`/`renderCSS` (`@theatre/core`), construction d'un `ReaderData`, puis `TheatreReader.boot()`. Le champ `ReaderData.audio.clips` (`Record<nodeId, string>`) est consommé **tel quel comme URL** par `Chrome.tsx` — on y met une URL serveur (mode en ligne) puis une URL de fichier local (hors-ligne) : **`reader-runtime` ne change pas d'une ligne**. Capacitor empaquette ce bundle en app iOS ; le contenu est synchronisé à l'exécution vers le FS natif.

**Tech Stack:** TypeScript, pnpm monorepo (internal packages), Preact (React aliasé), Vite 6, Fastify, Capacitor (`core`, `ios`, `filesystem`), Vitest.

## Global Constraints

- **Rendu = source unique** : ne JAMAIS réimplémenter le rendu. Le HTML de la pièce vient exclusivement de `renderBody`/`renderCSS` (`@theatre/core`). (CLAUDE.md « rendering contract »)
- **Invariant `reader-runtime`** : React ne possède JAMAIS le texte de la pièce. Le chrome est monté dans un conteneur séparé (`#reader-chrome`) ; `.play` est muté impérativement (annotations, audio, recherche). Ne pas l'enfreindre.
- **`@theatre/reader-ui`** : rien n'y possède le HTML de la pièce ; les composants y sont présentationnels (tout passe par props).
- **Parité de clé audio** : toute clé passe par `speechTextForTts(node)` + `buildNodeIds(play)` + `model`/`settings` de `play.audio`, format `DEFAULT_OUTPUT_FORMAT = 'mp3_44100_128'`. Les clips hors-ligne sont les MÊMES `.mp3` que la lecture en ligne / `/tts/batch`. (CLAUDE.md « Audio cache »)
- **Fastify reste sur `127.0.0.1`** — ne pas ouvrir le LAN. Tailscale = transport HTTPS (satisfait l'ATS iOS).
- **Contenu synchronisé à l'exécution**, jamais bundlé au build (l'app reste « pas figée »).
- **`@theatre/ui` expose son CSS en chaînes** (`uiCss`) : l'injecter, ne pas viser des fichiers `.css`.
- UI en français. `pnpm`. Node ≥ 20. `\rm` au lieu de `rm`. Typecheck par paquet.
- Multi-pièces : l'app liste les pièces (serveur si joignable, sinon locales).

**Baseline au moment de la révision : 86 tests verts (12 fichiers).**

---

## File Structure

**Serveur (`packages/server/src/`)**
- `server.ts` — MODIFIER : ajouter `GET /api/plays/:slug/audio/:key`.
- `audio-get.test.ts` — CRÉER.
- `reader-export.ts` — MODIFIER (T2) : déléguer la construction du document. SUPPRIMÉ en T9.

**Partagé (`packages/reader-ui/src/`)**
- `document.ts` — CRÉER : `buildReaderDocument()` (pur, sans I/O) → `{ body, css, data, title }`. Source **unique** du `ReaderData`, utilisée par l'export ET l'app mobile.
- `document.test.ts` — CRÉER.

**App mobile (`packages/mobile-app/`) — NOUVEAU paquet**
- `package.json`, `vite.config.ts`, `index.html`, `tsconfig.json`, `capacitor.config.ts`
- `src/main.ts` — entrée : charge, monte le document, `boot()`.
- `src/api.ts` — client HTTP vers le Mac + `buildAudioItems` + `buildOnlineClips`.
- `src/settings.ts` — base URL persistée.
- `src/offline/store.ts` — FS natif (Capacitor Filesystem).
- `src/offline/prepare.ts` (+ `prepare.test.ts`) — sync + manifeste `nodeId→key`.
- `src/ui/Picker.tsx` — choix de pièce, réglage URL, « Préparer hors-ligne ».

**Web (`packages/web/`)** — inchangé au Jalon 1, sauf T9 (retrait du bouton d'export).

---

## Task 1: Endpoint serveur `GET /api/plays/:slug/audio/:key`

**Files:**
- Modify: `packages/server/src/server.ts` (après la route `/tts/batch`)
- Test: `packages/server/src/audio-get.test.ts`

**Interfaces:**
- Consumes: `readAudioCache(slug, key)` (`storage.ts`), `buildServer()`.
- Produces: `GET /api/plays/:slug/audio/:key` → `200 audio/mpeg` si présent, `404 {error}` sinon, `Cache-Control: public, max-age=31536000, immutable` (la clé est un hash de contenu → immuable).

- [ ] **Step 1: Écrire le test qui échoue**

Créer `packages/server/src/audio-get.test.ts` :

```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, beforeAll } from 'vitest';
import type { FastifyInstance } from 'fastify';

// DATA_DIR (storage) est mémoïsé à l'import : dossier temporaire AVANT les imports.
const DATA_DIR = mkdtempSync(join(tmpdir(), 'theatre-audio-get-'));
process.env.THEATRE_DATA_DIR = DATA_DIR;

const { buildServer } = await import('./server');
const { writeAudioCache } = await import('./storage');

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildServer();
});

describe('GET /api/plays/:slug/audio/:key', () => {
  it('sert un clip en cache en audio/mpeg', async () => {
    const bytes = Buffer.from('FAKE-MP3-abc');
    await writeAudioCache('piece', 'deadbeef', bytes);
    const res = await app.inject({ method: 'GET', url: '/api/plays/piece/audio/deadbeef' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('audio/mpeg');
    expect(res.rawPayload.equals(bytes)).toBe(true);
  });

  it('404 si le clip est absent', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/plays/piece/audio/manquant' });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Lancer → échec attendu**

Run: `pnpm vitest run packages/server/src/audio-get.test.ts`
Expected: FAIL (route inexistante).

- [ ] **Step 3: Implémenter la route**

Dans `packages/server/src/server.ts`, après la fermeture de la route `/api/plays/:slug/tts/batch` :

```ts
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
```

- [ ] **Step 4: Lancer → succès**

Run: `pnpm vitest run packages/server/src/audio-get.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/server.ts packages/server/src/audio-get.test.ts
git commit -m "feat(server): GET /api/plays/:slug/audio/:key (clip audio en cache, cachable)"
```

---

## Task 2: Constructeur de document partagé (`buildReaderDocument`)

`exportReaderHtml` est aujourd'hui le seul endroit qui sait fabriquer un `ReaderData`. L'app mobile doit fabriquer **le même** → on extrait plutôt que de dupliquer (dérive garantie sinon).

**Files:**
- Create: `packages/reader-ui/src/document.ts`, `packages/reader-ui/src/document.test.ts`
- Modify: `packages/reader-ui/src/index.ts` (ré-export), `packages/reader-runtime/src/types.ts` (ré-exporte le type), `packages/server/src/reader-export.ts` (délègue)

**Interfaces:**
- Produces: `buildReaderDocument(input: ReaderDocumentInput): ReaderDocument` où
  `ReaderDocument = { body: string; css: string; data: ReaderData; title: string }` et
  `ReaderDocumentInput = { fountain, characters, template, notes?, storageKey, clips?, myCharacterId? }`.
  `clips?: Record<string, string>` = nodeId → **URL opaque** (data URI, URL serveur ou fichier local).

- [ ] **Step 1: Écrire le test qui échoue**

Créer `packages/reader-ui/src/document.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { actorReadingTemplate } from '@theatre/core';
import { buildReaderDocument } from './document';

const SRC = `# ACTE I.\n\n## SCENE I.\n\nMICHEL\nBonjour à tous.\n\nBENJI\nSalut Michel.\n`;

describe('buildReaderDocument', () => {
  it('produit body + css + data cohérents', () => {
    const doc = buildReaderDocument({
      fountain: SRC,
      characters: [],
      template: actorReadingTemplate,
      storageKey: 'theatre-reader:piece',
    });
    expect(doc.body).toContain('class="play"');
    expect(doc.css.length).toBeGreaterThan(0);
    expect(doc.data.characters.map((c) => c.name)).toContain('MICHEL');
    expect(doc.data.toc.length).toBeGreaterThan(0);
    expect(doc.data.storageKey).toBe('theatre-reader:piece');
    expect(doc.data.audio).toBeUndefined(); // aucun clip → pas de bloc audio
  });

  it('expose les clips tels quels (URL opaque) et mon rôle', () => {
    const doc = buildReaderDocument({
      fountain: SRC,
      characters: [],
      template: actorReadingTemplate,
      storageKey: 'k',
      clips: { 'n-1': 'file:///local/a.mp3' },
      myCharacterId: 'michel',
    });
    expect(doc.data.audio?.clips['n-1']).toBe('file:///local/a.mp3');
    expect(doc.data.audio?.myCharacterId).toBe('michel');
  });
});
```

- [ ] **Step 2: Lancer → échec**

Run: `pnpm vitest run packages/reader-ui/src/document.test.ts`
Expected: FAIL (`./document` inexistant).

- [ ] **Step 3: Implémenter `document.ts`**

Reprendre EXACTEMENT la logique actuelle de `reader-export.ts` (construction de `body`/`css`/`toc`/`data`) :

```ts
/**
 * Construction du document lecteur (body + css + ReaderData) — pur, sans I/O.
 * Source UNIQUE partagée par l'export .html et l'app mobile Capacitor : les deux
 * doivent produire un ReaderData identique, sinon ils dérivent.
 */
import {
  parseFountain, renderBody, renderCSS, buildToc,
  type Character, type Note, type Template,
} from '@theatre/core';

export interface ReaderData {
  characters: { id: string; name: string }[];
  toc: { id: string; label: string; scene: boolean }[];
  highlightsDefault: { characterId: string; color: string }[];
  notes?: Note[];
  storageKey: string;
  /** Audio : nodeId -> URL (data URI, URL serveur ou fichier local — opaque ici). */
  audio?: { clips: Record<string, string>; myCharacterId?: string };
}

export interface ReaderDocumentInput {
  fountain: string;
  characters: Character[];
  template: Template;
  notes?: Note[];
  storageKey: string;
  clips?: Record<string, string>;
  myCharacterId?: string;
}

export interface ReaderDocument {
  body: string;
  css: string;
  data: ReaderData;
  title: string;
}

export function buildReaderDocument(input: ReaderDocumentInput): ReaderDocument {
  const play = parseFountain(input.fountain, input.characters);
  const hasClips = Boolean(input.clips && Object.keys(input.clips).length);
  return {
    body: renderBody(play, input.template),
    css: renderCSS(input.template),
    title: play.title ?? 'Pièce',
    data: {
      characters: play.characters.map((c) => ({ id: c.id, name: c.canonicalName })),
      toc: buildToc(play, input.template).map((e) => ({ id: e.id, label: e.label, scene: e.scene })),
      highlightsDefault: input.template.highlights.map((h) => ({
        characterId: h.characterId,
        color: h.color,
      })),
      notes: input.notes ?? [],
      storageKey: input.storageKey,
      ...(hasClips ? { audio: { clips: input.clips!, myCharacterId: input.myCharacterId } } : {}),
    },
  };
}
```

Ré-exporter depuis `packages/reader-ui/src/index.ts` :
```ts
export { buildReaderDocument, type ReaderData, type ReaderDocument, type ReaderDocumentInput } from './document';
```

- [ ] **Step 4: Faire de reader-ui la source unique du type**

Dans `packages/reader-runtime/src/types.ts`, remplacer la déclaration locale de `ReaderData` par :
```ts
export type { ReaderData } from '@theatre/reader-ui';
```
(`@theatre/reader-ui` est déjà dans les `dependencies` de `reader-runtime`.)

- [ ] **Step 5: Faire déléguer `reader-export.ts`**

Remplacer la construction manuelle par :
```ts
const doc = buildReaderDocument({
  fountain, characters, template, notes,
  storageKey: `theatre-reader:${slug}`,
  clips: audio?.clips,
  myCharacterId: audio?.myCharacterId,
});
```
puis utiliser `doc.body`, `doc.css`, `doc.data`, `doc.title` dans le template HTML. Le reste (bundling esbuild, shell HTML, data URIs) est inchangé.

- [ ] **Step 6: Tests complets — non-régression de l'export**

Run: `pnpm test && pnpm typecheck`
Expected: 86 tests + les nouveaux passent. **`reader-export.test.ts` et `reader-export-audio.test.ts` doivent rester verts SANS modification** — c'est le filet qui prouve que l'extraction n'a rien changé.

- [ ] **Step 7: Commit**

```bash
git add packages/reader-ui/src packages/reader-runtime/src/types.ts packages/server/src/reader-export.ts
git commit -m "refactor(reader-ui): buildReaderDocument partagé par l'export et l'app mobile"
```

---

## Task 3: Paquet `@theatre/mobile-app` — lecteur en ligne

Premier jalon **dérisqué** : une app autonome qui affiche le lecteur mobile **contre le Mac**, sans une ligne de code hors-ligne. Possible uniquement parce que `clips` accepte une URL serveur.

**Files:**
- Create: `packages/mobile-app/{package.json,vite.config.ts,index.html,tsconfig.json}`
- Create: `packages/mobile-app/src/{main.ts,api.ts,settings.ts}`

**Interfaces:**
- Consumes: `buildReaderDocument` (T2), `boot` (`@theatre/reader-runtime`), `uiCss` (`@theatre/ui`), `GET /audio/:key` (T1).
- Produces: `mountReader(doc: ReaderDocument): void`.

- [ ] **Step 1: Créer le paquet**

`packages/mobile-app/package.json` :
```json
{
  "name": "@theatre/mobile-app",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@theatre/core": "workspace:*",
    "@theatre/reader-runtime": "workspace:*",
    "@theatre/reader-ui": "workspace:*",
    "@theatre/ui": "workspace:*",
    "preact": "^10.29.7"
  },
  "devDependencies": {
    "typescript": "^5.7.3",
    "vite": "^6.0.7"
  }
}
```

`packages/mobile-app/vite.config.ts` — aliaser React sur Preact (comme le bundling de l'export) :
```ts
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    alias: {
      react: 'preact/compat',
      'react-dom': 'preact/compat',
      'react-dom/client': 'preact/compat/client',
    },
  },
  optimizeDeps: { exclude: ['@theatre/core'] },
});
```

`packages/mobile-app/index.html` — reprendre le shell de `reader-export.ts` :
```html
<!doctype html>
<html lang="fr" data-theme="light">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>Theatre Reader</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { -webkit-text-size-adjust: 100%; padding: 0 16px; }
  .play { max-width: none; }
</style>
</head>
<body>
<div id="app"></div>
<script type="module" src="/src/main.ts"></script>
</body>
</html>
```

> `data-theme="light"` est délibéré : le texte est rendu par `@theatre/core` en encre sombre sur papier blanc (rendu partagé avec le PDF). Cf. commentaire dans `reader-export.ts`.

- [ ] **Step 2: `settings.ts`**

```ts
const KEY = 'theatre:apiBase';
export const getApiBase = (): string => (localStorage.getItem(KEY) ?? '').replace(/\/+$/, '');
export const setApiBase = (url: string): void => localStorage.setItem(KEY, url.replace(/\/+$/, ''));
export const apiUrl = (path: string): string => getApiBase() + path;
```

- [ ] **Step 3: `api.ts`**

```ts
import {
  parseFountain, buildNodeIds, speechTextForTts,
  type AudioConfig, type Character, type Note, type Template,
} from '@theatre/core';
import { apiUrl } from './settings';

export interface PlayMeta { name: string; characters: Character[]; template: Template; audio?: AudioConfig }
export interface TtsBatchItem { nodeId: string; text: string; voiceId: string }

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

export const listPlays = async (): Promise<{ slug: string; name: string }[]> =>
  (await json<{ plays: { slug: string; name: string }[] }>(await fetch(apiUrl('/api/plays')))).plays;

export const loadPlay = (slug: string): Promise<{ fountain: string; meta: PlayMeta }> =>
  fetch(apiUrl(`/api/plays/${encodeURIComponent(slug)}`)).then(json);

export const loadNotes = async (slug: string): Promise<Note[]> =>
  (await json<{ notes: Note[] }>(await fetch(apiUrl(`/api/plays/${encodeURIComponent(slug)}/notes`)))).notes;

export const audioUrl = (slug: string, key: string): string =>
  apiUrl(`/api/plays/${encodeURIComponent(slug)}/audio/${key}`);

/** Items /tts/batch avec le VRAI nodeId (= data-nid du DOM) et le texte canonique. */
export function buildAudioItems(fountain: string, characters: Character[], audio: AudioConfig): TtsBatchItem[] {
  if (!audio.voices || !Object.keys(audio.voices).length) return [];
  const play = parseFountain(fountain, characters);
  const ids = buildNodeIds(play);
  const items: TtsBatchItem[] = [];
  play.nodes.forEach((n, i) => {
    if (n.type !== 'line') return;
    const voiceId = audio.voices?.[n.characterId];
    if (!voiceId) return;
    const text = speechTextForTts(n);
    if (text) items.push({ nodeId: ids[i]!, text, voiceId });
  });
  return items;
}

/** Demande le manifeste au serveur et renvoie nodeId -> URL serveur (mode en ligne). */
export async function buildOnlineClips(slug: string, fountain: string, meta: PlayMeta): Promise<Record<string, string>> {
  const items = buildAudioItems(fountain, meta.characters, meta.audio ?? {});
  if (!items.length) return {};
  const res = await fetch(apiUrl(`/api/plays/${encodeURIComponent(slug)}/tts/batch`), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ items, model: meta.audio?.model, settings: meta.audio?.settings }),
  });
  if (!res.ok) return {};
  const { manifest } = await json<{ manifest: Record<string, { key: string }> }>(res);
  const clips: Record<string, string> = {};
  for (const [nodeId, { key }] of Object.entries(manifest)) clips[nodeId] = audioUrl(slug, key);
  return clips;
}
```

- [ ] **Step 4: `main.ts` + `mountReader`**

```ts
import { buildReaderDocument, type ReaderDocument } from '@theatre/reader-ui';
import { boot } from '@theatre/reader-runtime';
import { uiCss } from '@theatre/ui';
import * as api from './api';
import { getApiBase } from './settings';

function injectStyle(css: string): void {
  const s = document.createElement('style');
  s.textContent = css;
  document.head.appendChild(s);
}

/** Injecte le document (styles + .play) PUIS démarre le chrome du lecteur. */
export function mountReader(doc: ReaderDocument): void {
  injectStyle(uiCss);
  injectStyle(doc.css);
  // Neutralise la pagination : reflow continu (cf. reader-export.ts).
  injectStyle('.toc-item a::after{content:none!important}.toc,.distribution--break{break-after:auto}');
  document.getElementById('app')!.innerHTML = doc.body;
  (window as unknown as { __THEATRE_READER_DATA__?: unknown }).__THEATRE_READER_DATA__ = doc.data;
  document.title = doc.title;
  boot();
}

async function main(): Promise<void> {
  const slug = new URLSearchParams(location.search).get('slug');
  if (!getApiBase() || !slug) return; // écran de choix : Task 6
  const { fountain, meta } = await api.loadPlay(slug);
  const notes = await api.loadNotes(slug).catch(() => []);
  const clips = await api.buildOnlineClips(slug, fountain, meta);
  mountReader(buildReaderDocument({
    fountain, characters: meta.characters, template: meta.template, notes,
    storageKey: `theatre-reader:${slug}`, clips, myCharacterId: meta.audio?.myCharacterId,
  }));
}

void main();
```

> **Ordre impératif** : `.play` doit exister dans le DOM et `__THEATRE_READER_DATA__` être posé **avant** `boot()` (le runtime fait `querySelector('.play')` et lit le global une seule fois).

- [ ] **Step 5: Vérifier en navigateur (avant tout iOS)**

```bash
pnpm install
pnpm start                                   # serveur :3001 dans un autre terminal
pnpm --filter @theatre/mobile-app dev
```
Dans la console du navigateur : `localStorage.setItem('theatre:apiBase','http://127.0.0.1:3001')`, puis ouvrir `?slug=<ta-piece>`.
Attendu : la pièce s'affiche avec le chrome mobile (barre transport, sheet Options), la recherche fonctionne, l'audio joue depuis le serveur.

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm --filter @theatre/mobile-app typecheck`

```bash
git add packages/mobile-app pnpm-lock.yaml
git commit -m "feat(mobile-app): app lecteur autonome (Preact) branchée sur le serveur"
```

---

## Task 4: Store hors-ligne (Capacitor Filesystem)

**Files:** Create `packages/mobile-app/src/offline/store.ts`

**Interfaces:**
- Produces : `savePlay/loadPlay`, `saveNotes/loadNotes`, `saveManifest/loadManifest`, `saveClip(slug,key,base64)`, `clipUrl(slug,key): Promise<string>`, `listLocalPlays()`.
- Layout : `theatre/<slug>/{play.json,notes.json,audio-manifest.json,audio/<key>.mp3}` sous `Directory.Data`.

- [ ] **Step 1: Installer les plugins**

Run: `pnpm --filter @theatre/mobile-app add @capacitor/core @capacitor/filesystem`

- [ ] **Step 2: Implémenter `store.ts`**

```ts
/** Persistance hors-ligne sur le FS natif (Capacitor). */
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';
import type { Note } from '@theatre/core';
import type { PlayMeta } from '../api';

const DIR = Directory.Data;
const ROOT = 'theatre';
const dir = (slug: string) => `${ROOT}/${slug}`;

export interface OfflinePlay { fountain: string; meta: PlayMeta }
export interface AudioManifest { map: Record<string, string> } // nodeId -> key

async function writeJson(path: string, value: unknown): Promise<void> {
  await Filesystem.mkdir({ path: path.split('/').slice(0, -1).join('/'), directory: DIR, recursive: true }).catch(() => {});
  await Filesystem.writeFile({ path, directory: DIR, encoding: Encoding.UTF8, data: JSON.stringify(value) });
}
async function readJson<T>(path: string): Promise<T | null> {
  try {
    const r = await Filesystem.readFile({ path, directory: DIR, encoding: Encoding.UTF8 });
    return JSON.parse(r.data as string) as T;
  } catch { return null; }
}

export const savePlay = (slug: string, d: OfflinePlay) => writeJson(`${dir(slug)}/play.json`, d);
export const loadPlay = (slug: string) => readJson<OfflinePlay>(`${dir(slug)}/play.json`);
export const saveNotes = (slug: string, n: Note[]) => writeJson(`${dir(slug)}/notes.json`, n);
export const loadNotes = async (slug: string) => (await readJson<Note[]>(`${dir(slug)}/notes.json`)) ?? [];
export const saveManifest = (slug: string, m: AudioManifest) => writeJson(`${dir(slug)}/audio-manifest.json`, m);
export const loadManifest = (slug: string) => readJson<AudioManifest>(`${dir(slug)}/audio-manifest.json`);

export async function saveClip(slug: string, key: string, base64: string): Promise<void> {
  await Filesystem.mkdir({ path: `${dir(slug)}/audio`, directory: DIR, recursive: true }).catch(() => {});
  await Filesystem.writeFile({ path: `${dir(slug)}/audio/${key}.mp3`, directory: DIR, data: base64 });
}

/** URL lisible par la WebView pour un clip local. */
export async function clipUrl(slug: string, key: string): Promise<string> {
  const { uri } = await Filesystem.getUri({ path: `${dir(slug)}/audio/${key}.mp3`, directory: DIR });
  return Capacitor.convertFileSrc(uri);
}

export async function listLocalPlays(): Promise<{ slug: string; name: string }[]> {
  try {
    const { files } = await Filesystem.readdir({ path: ROOT, directory: DIR });
    const out: { slug: string; name: string }[] = [];
    for (const f of files) {
      const slug = typeof f === 'string' ? f : f.name;
      const p = await loadPlay(slug);
      if (p) out.push({ slug, name: p.meta.name ?? slug });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  } catch { return []; }
}
```

> L'API exacte du plugin (forme de `readdir`, écriture base64 binaire) se valide sur device en T7 ; ajuster si la version diffère.

- [ ] **Step 3: Commit**

```bash
git add packages/mobile-app/src/offline/store.ts packages/mobile-app/package.json pnpm-lock.yaml
git commit -m "feat(mobile-app): store hors-ligne sur FS natif"
```

---

## Task 5: Synchronisation « Préparer hors-ligne »

**Files:** Create `packages/mobile-app/src/offline/prepare.ts` + `prepare.test.ts`

**Interfaces:**
- Produces : `prepareOffline(slug, onProgress?): Promise<{ prepared: number; skipped: number }>` et `buildOfflineClips(slug): Promise<Record<string,string>>` (nodeId → URL de fichier local).

- [ ] **Step 1: Verrou de parité (test de `buildAudioItems`)**

Créer `packages/mobile-app/src/offline/prepare.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { parseFountain, buildNodeIds, speechTextForTts } from '@theatre/core';
import { buildAudioItems } from '../api';

const SRC = `# ACTE I.\n\n## SCENE I.\n\nMICHEL\nBonjour à tous.\n\nBENJI\nSalut Michel.\n`;

describe('buildAudioItems — parité nodeId / texte', () => {
  it('utilise le vrai nodeId (= data-nid) et le texte canonique', () => {
    const play = parseFountain(SRC, []);
    const ids = buildNodeIds(play);
    const line = play.nodes.find((n) => n.type === 'line');
    if (!line || line.type !== 'line') throw new Error('fixture invalide');
    const idx = play.nodes.indexOf(line);
    const items = buildAudioItems(SRC, [], { voices: { [line.characterId]: 'v1' } });
    expect(items).toHaveLength(1);
    expect(items[0]!.nodeId).toBe(ids[idx]);
    expect(items[0]!.text).toBe(speechTextForTts(line));
  });
});
```

- [ ] **Step 2: Lancer → doit PASSER** (la fonction existe depuis T3 ; ce test la verrouille)

Run: `pnpm vitest run packages/mobile-app/src/offline/prepare.test.ts`
Expected: PASS. Si FAIL → corriger `buildAudioItems` : c'est le verrou de parité de clé, une dérive ici = cache manqué + appels ElevenLabs gaspillés.

- [ ] **Step 3: Implémenter `prepare.ts`**

```ts
/** Sync hors-ligne : pièce + notes + clips → FS natif. Cache-first, idempotent. */
import * as api from '../api';
import * as store from './store';
import { apiUrl } from '../settings';

async function fetchBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`clip indisponible (${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export async function prepareOffline(
  slug: string,
  onProgress?: (done: number, total: number) => void,
): Promise<{ prepared: number; skipped: number }> {
  const { fountain, meta } = await api.loadPlay(slug);
  const notes = await api.loadNotes(slug).catch(() => []);
  await store.savePlay(slug, { fountain, meta });
  await store.saveNotes(slug, notes);

  const items = api.buildAudioItems(fountain, meta.characters, meta.audio ?? {});
  const map: Record<string, string> = {};
  let prepared = 0, skipped = 0;
  const CHUNK = 10;
  for (let i = 0; i < items.length; i += CHUNK) {
    const chunk = items.slice(i, i + CHUNK);
    const res = await fetch(apiUrl(`/api/plays/${encodeURIComponent(slug)}/tts/batch`), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: chunk, model: meta.audio?.model, settings: meta.audio?.settings }),
    });
    if (!res.ok) { skipped += chunk.length; continue; }
    const { manifest } = (await res.json()) as { manifest: Record<string, { key: string }> };
    for (const [nodeId, { key }] of Object.entries(manifest)) {
      try {
        await store.saveClip(slug, key, await fetchBase64(api.audioUrl(slug, key)));
        map[nodeId] = key;
        prepared += 1;
      } catch { skipped += 1; }
      onProgress?.(prepared + skipped, items.length);
    }
  }
  await store.saveManifest(slug, { map });
  return { prepared, skipped };
}

/** nodeId -> URL de fichier local (à injecter dans ReaderData.audio.clips). */
export async function buildOfflineClips(slug: string): Promise<Record<string, string>> {
  const m = await store.loadManifest(slug);
  if (!m) return {};
  const clips: Record<string, string> = {};
  for (const [nodeId, key] of Object.entries(m.map)) clips[nodeId] = await store.clipUrl(slug, key);
  return clips;
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/mobile-app/src/offline
git commit -m "feat(mobile-app): préparation hors-ligne (manifeste nodeId→clé + clips sur le FS)"
```

---

## Task 6: Écran de choix + démarrage local-first

**Files:** Create `packages/mobile-app/src/ui/Picker.tsx` · Modify `packages/mobile-app/src/main.ts`

- [ ] **Step 1: `Picker.tsx`**

Composant Preact affichant :
- champ « Adresse du Mac (Tailscale) », placeholder `https://mon-mac.tailnet.ts.net`, persisté via `setApiBase`.
- la liste des pièces : `api.listPlays()` si le serveur répond, sinon `store.listLocalPlays()` avec un badge « hors-ligne ».
- par pièce : « Ouvrir » et, si le serveur répond, « Préparer hors-ligne » (progression via `onProgress`).
Utiliser les primitives de `@theatre/ui` pour rester cohérent visuellement.

- [ ] **Step 2: `main.ts` — ouverture local-first**

```ts
async function openPlay(slug: string): Promise<void> {
  const local = await store.loadPlay(slug);
  const offlineClips = await buildOfflineClips(slug);
  let fountain: string, meta: api.PlayMeta, notes: Note[], clips: Record<string, string>;
  if (local && Object.keys(offlineClips).length) {
    // Local-first : instantané, et fonctionne sans réseau.
    ({ fountain, meta } = local);
    notes = await store.loadNotes(slug);
    clips = offlineClips;
  } else {
    ({ fountain, meta } = await api.loadPlay(slug));
    notes = await api.loadNotes(slug).catch(() => []);
    clips = await api.buildOnlineClips(slug, fountain, meta);
  }
  mountReader(buildReaderDocument({
    fountain, characters: meta.characters, template: meta.template, notes,
    storageKey: `theatre-reader:${slug}`, clips, myCharacterId: meta.audio?.myCharacterId,
  }));
}
```
Au démarrage : pas de base URL OU pas de pièce choisie → afficher `Picker`.

> **`boot()` est à un coup** (lit le global une fois). Pour revenir au `Picker` / changer de pièce, recharger la vue (`location.reload()` avec le slug en query) plutôt que de démonter le chrome — simple et sans toucher à `reader-runtime`.

- [ ] **Step 3: Vérifier en navigateur** (serveur lancé) : choix de pièce, ouverture, audio en ligne OK.

- [ ] **Step 4: Commit**

```bash
git add packages/mobile-app/src
git commit -m "feat(mobile-app): écran de choix (URL du Mac, pièces locales/serveur) + ouverture local-first"
```

---

## Task 7: Projet Capacitor iOS + validation device

**Files:** Create `packages/mobile-app/capacitor.config.ts`, `packages/mobile-app/ios/` (généré)

- [ ] **Step 1: Installer et configurer**

```bash
pnpm --filter @theatre/mobile-app add -D @capacitor/cli @capacitor/ios
```

`packages/mobile-app/capacitor.config.ts` :
```ts
import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'fr.avolo.theatrereader',
  appName: 'Theatre Reader',
  webDir: 'dist',
  ios: { contentInset: 'always' },
};
export default config;
```

- [ ] **Step 2: Scaffolder iOS**

```bash
pnpm --filter @theatre/mobile-app build
cd packages/mobile-app && pnpm exec cap add ios && pnpm exec cap sync ios
```
Ajouter aux scripts de `packages/mobile-app/package.json` :
```json
"cap:sync": "cap sync ios",
"ios": "vite build && cap sync ios && cap open ios"
```

- [ ] **Step 3: Build & run sur device**

Run: `cd packages/mobile-app && pnpm exec cap open ios` → Xcode : équipe de signature (compte dev Apple), device, Run.

Validation manuelle **dans cet ordre** :
1. Renseigner l'URL Tailscale → la liste des pièces s'affiche.
2. Ouvrir une pièce (serveur joignable) → texte + chrome mobile + audio en ligne OK.
3. « Préparer hors-ligne » → « N clips préparés ».
4. **Couper le réseau / éteindre le serveur**, relancer l'app → la pièce s'ouvre depuis le FS et **l'audio joue hors-ligne**.
5. Vérifier la sheet Options, les modes de répétition et la recherche.

- [ ] **Step 4: Commit**

```bash
git add packages/mobile-app/capacitor.config.ts packages/mobile-app/package.json packages/mobile-app/ios .gitignore pnpm-lock.yaml
git commit -m "feat(ios): app Capacitor embarquant le lecteur mobile (hors-ligne)"
```

---

## Task 8: Documentation

**Files:** `README.md` / `CLAUDE.md`

- [ ] **Step 1: Section « Lecteur mobile (iOS/Capacitor) »**
- Tailscale sur le Mac et le téléphone, même tailnet. `tailscale serve --bg 3001` → `https://<mac>.ts.net` → `127.0.0.1:3001`. Fastify reste sur loopback.
- Cycle de livraison : `pnpm --filter @theatre/mobile-app ios` (build + sync + Xcode) pour une nouvelle version **du code** ; le **contenu** se met à jour par « Préparer hors-ligne », **sans rebuild**.
- Architecture : `mobile-app` = shell + sync ; le lecteur est `@theatre/reader-runtime` ; le document vient de `buildReaderDocument` (`@theatre/reader-ui`) ; `Reader.tsx` reste le lecteur desktop.

- [ ] **Step 2: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: lecteur mobile Capacitor (Tailscale, déploiement, architecture)"
```

---

## Task 9: Retrait différé de l'export HTML

**À faire APRÈS la validation device (T7).** Décision utilisateur : **retrait différé** — l'export reste le filet tant que l'app n'est pas prouvée sur le téléphone.

⚠️ **`@theatre/reader-runtime` est CONSERVÉ** (c'est le lecteur de l'app). On ne retire que l'assemblage `.html` et son déclenchement.

**Files:**
- Delete: `packages/server/src/reader-export.ts`, `reader-export.test.ts`, `reader-export-audio.test.ts`
- Modify: `packages/server/src/server.ts` (route `/api/export/reader`, import, champs audio de `ExportBody`), `server.test.ts`
- Modify: `packages/web/src/api.ts` (`exportReader`, `ReaderExportAudio`), `packages/web/src/App.tsx` (bouton, commande palette, état `exportWithAudio`)

- [ ] **Step 1: Inventaire**

Run: `grep -rn "export/reader\|exportReader\|exportReaderHtml" packages --include="*.ts" --include="*.tsx"`

- [ ] **Step 2: Supprimer et nettoyer** en suivant l'inventaire. **Conserver** `reader-runtime`, `reader-ui`, `ui`.

- [ ] **Step 3: Tests + typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: vert (les 5 tests d'export en moins).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: retire l'export HTML autonome (remplacé par l'app iOS Capacitor)"
```

---

## Self-Review

**Couverture :** endpoint audio (T1) · document partagé (T2) · app lecteur en ligne (T3) · store FS (T4) · sync hors-ligne + parité de clé (T5) · local-first + choix de pièce (T6) · iOS + validation device (T7) · doc (T8) · retrait différé de l'export (T9). Jalon 2 (audio natif en arrière-plan) = plan séparé.

**Cohérence des types :** `ReaderData` défini **une seule fois** (`reader-ui/document.ts`, ré-exporté par `reader-runtime/types.ts`) ; `clips: Record<nodeId, string>` produit par `buildOnlineClips` (URL serveur) ou `buildOfflineClips` (URL fichier) et consommé tel quel par `resolveAudio` de `Chrome.tsx` ; `buildAudioItems` partagé entre mode en ligne (T3) et sync (T5) ; `PlayMeta` défini dans `mobile-app/src/api.ts` et consommé par `offline/store.ts`.

**Invariants respectés :** rendu unique (`renderBody`/`renderCSS` seuls producteurs du HTML de pièce) ; React ne possède pas le texte (`mountReader` pose `.play`, puis `boot()` monte le chrome à côté) ; parité de clé (`speechTextForTts` + `buildNodeIds` + `mp3_44100_128`).

## Points de vigilance

- **`boot()` est à un coup** : il lit `window.__THEATRE_READER_DATA__` une fois. Changer de pièce = recharger la vue (T6), ou assouplir `reader-runtime` plus tard.
- **ATS iOS** : valider que Tailscale HTTPS passe sans exception.
- **API `@capacitor/filesystem`** : forme de `readdir`, écriture base64 binaire — ajuster sur device.
- **Volume audio** : valider la durée de « Préparer hors-ligne » et la place disque sur une pièce entière.
- **Poids du bundle** : vérifier que `mobile-app` n'embarque ni Paged.js ni React complet (alias Preact effectif) — `vite build` doit rester léger.
