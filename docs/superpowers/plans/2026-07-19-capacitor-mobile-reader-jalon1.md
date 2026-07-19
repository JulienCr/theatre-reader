# Lecteur mobile Capacitor — Jalon 1 : boucle offline

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer l'export HTML autonome par une app iOS Capacitor qui embarque le reader web existant, synchronise texte + notes + audio depuis le Mac (via Tailscale) vers le système de fichiers natif, et permet la répétition 100 % hors-ligne.

**Architecture:** Le reader web (`Reader.tsx`, rendu canonique `@theatre/core`) est bundlé dans une app Capacitor → shell offline par construction. Le contenu est synchronisé à l'exécution par un bouton « Préparer hors-ligne » qui écrit sur le FS natif (Capacitor Filesystem) et lit ensuite depuis le FS quand le Mac est injoignable. Seule addition serveur : `GET /api/plays/:slug/audio/:key` (les POST ne se prêtent pas au téléchargement/stockage simple). L'ancien export et le package `@theatre/reader-runtime` sont retirés.

**Tech Stack:** TypeScript, pnpm monorepo (internal packages, no build for core), React 19 + Vite 6, Fastify, Capacitor (`@capacitor/core`, `@capacitor/ios`, `@capacitor/filesystem`, `@capacitor/preferences`), Vitest.

## Global Constraints

- **Rendu = source unique** : ne JAMAIS réimplémenter le rendu. Réutiliser `renderBody` / `renderCSS` / `Reader.tsx` / `@theatre/audio-player`. (spec + CLAUDE.md « rendering contract »)
- **Parité de clé audio** : toute construction de clé passe par `speechTextForTts(node)` (texte canonique) + `buildNodeIds(play)` (nodeId) + le `model`/`settings` de `play.audio`, format `DEFAULT_OUTPUT_FORMAT = 'mp3_44100_128'`. Les clips offline sont les MÊMES fichiers `.mp3` que la lecture en ligne / `/tts/batch`. (CLAUDE.md « Audio cache »)
- **Fastify reste sur `127.0.0.1`** (`main.ts:23`) — ne pas ouvrir le LAN. Tailscale est le transport HTTPS (satisfait l'ATS iOS).
- **Contenu synchronisé à l'exécution**, jamais bundlé au build (l'app reste « pas figée »).
- **UI en français.** `pnpm` (pas npm/yarn). Node ≥ 20. Typecheck par package (`pnpm -r typecheck`), pas de build de `core`.
- **`\rm`** au lieu de `rm` en shell (alias interactif).
- Multi-pièces : l'app liste toutes les pièces préparées localement.

---

## File Structure

**Serveur (`packages/server/src/`)**
- `server.ts` — MODIFIER : ajouter `GET /api/plays/:slug/audio/:key` ; retirer la route `/api/export/reader` + l'import `exportReaderHtml` + les champs audio de `ExportBody`.
- `audio-get.test.ts` — CRÉER : test du nouvel endpoint.
- `reader-export.ts`, `reader-export.test.ts`, `reader-export-audio.test.ts` — SUPPRIMER.
- `server.test.ts` — MODIFIER : retirer les cas qui frappent `/api/export/reader`.

**Web (`packages/web/src/`)**
- `api.ts` — MODIFIER : base URL configurable (`apiUrl`), retirer `exportReader`/`ReaderExportAudio`, ajouter `fetchAudioByKey`.
- `platform.ts` — CRÉER : `isNative()`, `getApiBase()`, `setApiBase()`.
- `platform.test.ts` — CRÉER : test de `apiUrl`/base.
- `offline/store.ts` — CRÉER : lecture/écriture FS natif (play, notes, manifeste audio, clips) + liste locale.
- `offline/prepare.ts` — CRÉER : construit le manifeste `nodeId→key` (fonction pure testable) + orchestre la sync.
- `offline/prepare.test.ts` — CRÉER : parité clé/nodeId du manifeste.
- `App.tsx` — MODIFIER : retirer l'export lecteur ; brancher le mode natif (read-only, local-first) + bouton « Préparer hors-ligne ».
- `components/Reader.tsx` — MODIFIER : `resolveAudio` bascule online (serveur) / offline (FS local).

**Packages**
- `packages/reader-runtime/` — SUPPRIMER (dossier entier).
- `pnpm-workspace.yaml` / dépendances — MODIFIER si référence à `reader-runtime`.

**Capacitor (racine + `packages/web/`)**
- `packages/web/capacitor.config.ts` — CRÉER.
- `packages/web/package.json` — MODIFIER : deps Capacitor + scripts `cap:*`.
- `packages/web/ios/` — GÉNÉRÉ par `cap add ios` (gitignoré sauf besoin).

**Docs**
- `README.md` / `CLAUDE.md` — MODIFIER : setup Tailscale + cycle de déploiement iOS.

---

## Task 1: Endpoint serveur `GET /api/plays/:slug/audio/:key`

**Files:**
- Modify: `packages/server/src/server.ts` (après la route `/tts/batch`, ~ligne 236)
- Test: `packages/server/src/audio-get.test.ts`

**Interfaces:**
- Consumes: `readAudioCache(slug, key)` (`storage.ts:106`), `buildServer()` (`server.ts:74`).
- Produces: `GET /api/plays/:slug/audio/:key` → `200 audio/mpeg` (corps = MP3) si le clip existe en cache, `404 {error}` sinon. `Cache-Control: public, max-age=31536000, immutable` (la clé est un hash du contenu → immuable).

- [ ] **Step 1: Écrire le test qui échoue**

Créer `packages/server/src/audio-get.test.ts` (calqué sur `reader-export-audio.test.ts` pour le dossier data temporaire) :

```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, beforeAll } from 'vitest';

// DATA_DIR (storage) est mémoïsé à l'import : on fixe un dossier temporaire AVANT les imports.
const DATA_DIR = mkdtempSync(join(tmpdir(), 'theatre-reader-audio-get-'));
process.env.THEATRE_DATA_DIR = DATA_DIR;

const { buildServer } = await import('./server');
const { writeAudioCache } = await import('./storage');
import type { FastifyInstance } from 'fastify';

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

- [ ] **Step 2: Lancer le test → échec attendu**

Run: `pnpm vitest run packages/server/src/audio-get.test.ts`
Expected: FAIL (route inexistante → 404 sur le 1er test).

- [ ] **Step 3: Implémenter la route**

Dans `packages/server/src/server.ts`, juste après la fermeture de la route `/api/plays/:slug/tts/batch` (après la ligne `);` ~236) :

```ts
  // Lecture seule du cache disque, par clé (hash contenu) : cachable → consommable par
  // l'app mobile (prépa hors-ligne). Pas de synthèse ici : la clé reste idempotente.
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

- [ ] **Step 4: Lancer le test → succès**

Run: `pnpm vitest run packages/server/src/audio-get.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck serveur**

Run: `pnpm --filter @theatre/server typecheck`
Expected: 0 erreur.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/server.ts packages/server/src/audio-get.test.ts
git commit -m "feat(server): GET /api/plays/:slug/audio/:key (clip audio en cache, cachable)"
```

---

## Task 2: Retirer l'ancien export HTML + `@theatre/reader-runtime`

Décision utilisateur : retrait immédiat, sans coexistence.

**Files:**
- Delete: `packages/server/src/reader-export.ts`, `reader-export.test.ts`, `reader-export-audio.test.ts`
- Delete: `packages/reader-runtime/` (dossier entier)
- Modify: `packages/server/src/server.ts`, `packages/server/src/server.test.ts`, `packages/web/src/api.ts`, `packages/web/src/App.tsx`

**Interfaces:**
- Produces: plus aucune référence à `exportReaderHtml`, `@theatre/reader-runtime`, `POST /api/export/reader`, `api.exportReader`.

- [ ] **Step 1: Vérifier qu'aucun autre code ne dépend de reader-runtime**

Run: `grep -rn "reader-runtime\|exportReaderHtml\|export/reader\|exportReader" packages --include="*.ts" --include="*.tsx" --include="*.json"`
Expected : occurrences uniquement dans les fichiers listés ci-dessous (server.ts, api.ts, App.tsx, reader-export*, reader-runtime/*, et les `package.json` de web/reader-runtime). Si une autre occurrence apparaît, l'ajouter au périmètre avant de continuer.

- [ ] **Step 2: Supprimer les fichiers d'export + le package runtime**

```bash
\rm packages/server/src/reader-export.ts \
    packages/server/src/reader-export.test.ts \
    packages/server/src/reader-export-audio.test.ts
\rm -rf packages/reader-runtime
```

- [ ] **Step 3: Nettoyer `server.ts`**

Dans `packages/server/src/server.ts` :
- Retirer l'import : `import { exportReaderHtml } from './reader-export';` (ligne ~21).
- Retirer la route `app.post<{ Body: ExportBody }>('/api/export/reader', …)` (lignes ~143-165).
- Dans `interface ExportBody`, retirer les champs propres à l'export lecteur : `notes?`, `slug?`, `audio?`, `includeAudio?`, `bitrate?`, `roles?` — ne garder que `fountain`, `characters`, `template` (utilisés par `/api/export` PDF). Retirer les imports devenus inutilisés (`AudioConfig`, `Note` si plus référencés ailleurs dans le fichier — vérifier avant de retirer).

- [ ] **Step 4: Nettoyer `server.test.ts`**

Run: `grep -n "export/reader\|exportReader" packages/server/src/server.test.ts`
Retirer chaque `it(...)`/bloc qui frappe `POST /api/export/reader`. Conserver les autres cas.

- [ ] **Step 5: Nettoyer `api.ts` (web)**

Dans `packages/web/src/api.ts` :
- Retirer `export interface ReaderExportAudio { … }` (lignes ~75-81).
- Retirer `export async function exportReader(…) { … }` (lignes ~83-103).
- Retirer l'import `Note` s'il n'est plus utilisé (il l'est encore par `loadNotes`/`saveNotes` → le garder).

- [ ] **Step 6: Nettoyer `App.tsx` (web)**

Dans `packages/web/src/App.tsx` :
- Retirer `onExportReader` (lignes ~210-240), l'état `exportWithAudio` (ligne ~48), le `useMemo` `audioEstimate` (lignes ~280-294) et l'entrée `exportWithAudio` de la liste de dépendances du `useMemo` `commands` (ligne ~402).
- Retirer la commande palette `export-reader` (ligne ~375).
- Retirer le bouton `<button onClick={onExportReader}>Lecteur mobile</button>` (ligne ~480) et le `<label className="toggle">…🔊 audio…</label>` (lignes ~490-502).
- CONSERVER `onGenerateAllAudio`, `audioBatchItems`, le bouton `🎙️ Générer l'audio` et l'import `speechTextForTts` (indépendants de l'export ; ils chauffent le cache que « Préparer hors-ligne » réutilisera).

- [ ] **Step 7: Typecheck + tests complets**

Run: `pnpm typecheck && pnpm test`
Expected: 0 erreur de type ; tous les tests passent (les 5 tests d'export supprimés en moins ; aucun test rouge).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: retire l'export HTML autonome et @theatre/reader-runtime (remplacés par la PWA/Capacitor)"
```

---

## Task 3: Base URL API configurable (`platform.ts`)

Sous Capacitor, la WebView charge `capacitor://localhost` : les `fetch('/api/...')` doivent viser le Mac (`https://<mac>.ts.net`). En web, la base reste vide (same-origin + proxy Vite).

**Files:**
- Create: `packages/web/src/platform.ts`
- Test: `packages/web/src/platform.test.ts`
- Modify: `packages/web/src/api.ts` (router tous les `fetch` via `apiUrl`)

**Interfaces:**
- Produces:
  - `isNative(): boolean` — vrai sous Capacitor natif.
  - `getApiBase(): string` — base URL API (`''` par défaut ; en natif, valeur stockée).
  - `setApiBase(url: string): void` — persiste la base (sans `/` final).
  - `apiUrl(path: string): string` — `getApiBase() + path` (path commence par `/api/...`).

- [ ] **Step 1: Écrire le test qui échoue**

Vitest tourne en environnement `happy-dom` (cf. racine `package.json` devDeps) → `localStorage` dispo. Créer `packages/web/src/platform.test.ts` :

```ts
import { describe, expect, it, beforeEach } from 'vitest';
import { apiUrl, getApiBase, setApiBase } from './platform';

beforeEach(() => localStorage.clear());

describe('platform apiUrl / base', () => {
  it('base vide par défaut → chemin relatif', () => {
    expect(getApiBase()).toBe('');
    expect(apiUrl('/api/plays')).toBe('/api/plays');
  });

  it('base persistée → préfixe absolu, sans double slash', () => {
    setApiBase('https://mac.tailnet.ts.net/');
    expect(getApiBase()).toBe('https://mac.tailnet.ts.net');
    expect(apiUrl('/api/plays/x/audio/k')).toBe('https://mac.tailnet.ts.net/api/plays/x/audio/k');
  });
});
```

- [ ] **Step 2: Lancer → échec**

Run: `pnpm vitest run packages/web/src/platform.test.ts`
Expected: FAIL (`./platform` inexistant).

- [ ] **Step 3: Implémenter `platform.ts`**

```ts
/** Détection de plateforme + base URL API (web = same-origin, natif = Mac via Tailscale). */
import { Capacitor } from '@capacitor/core';

const API_BASE_KEY = 'theatre:apiBase';

export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

export function getApiBase(): string {
  return (localStorage.getItem(API_BASE_KEY) ?? '').replace(/\/+$/, '');
}

export function setApiBase(url: string): void {
  localStorage.setItem(API_BASE_KEY, url.replace(/\/+$/, ''));
}

/** Préfixe un chemin `/api/...` par la base configurée. */
export function apiUrl(path: string): string {
  return getApiBase() + path;
}
```

- [ ] **Step 4: Router `api.ts` via `apiUrl`**

Dans `packages/web/src/api.ts`, importer `import { apiUrl } from './platform';` et remplacer chaque littéral `fetch('/api/...')` / `fetch(\`/api/...\`)` par `fetch(apiUrl('/api/...'))` / `fetch(apiUrl(\`/api/...\`))`. Endroits : `listPlays` (37), `importPdf` (44), `loadPlay` (49), `savePlay` (53), `exportPdf` (66), `listVoices` (107), `tts` (117), `ttsBatch` (151), `loadNotes` (166), `saveNotes` (172).

- [ ] **Step 5: Lancer les tests + typecheck**

Run: `pnpm vitest run packages/web/src/platform.test.ts && pnpm --filter @theatre/web typecheck`
Expected: PASS. (Le typecheck exige la dépendance `@capacitor/core` — installée en Task 7. Si non installée, faire d'abord `pnpm --filter @theatre/web add @capacitor/core` puis relancer.)

> Note : `@capacitor/core` est ajouté ici pour permettre l'import ; l'installation complète Capacitor (ios, filesystem, preferences) est en Task 7. Faire : `pnpm --filter @theatre/web add @capacitor/core`.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/platform.ts packages/web/src/platform.test.ts packages/web/src/api.ts packages/web/package.json pnpm-lock.yaml
git commit -m "feat(web): base URL API configurable (same-origin en web, Mac via Tailscale en natif)"
```

---

## Task 4: Store hors-ligne (Capacitor Filesystem)

Persistance locale sur le FS natif. Sur web (desktop), ces méthodes ne sont jamais appelées (UI gated par `isNative()`), mais le module doit compiler.

**Files:**
- Create: `packages/web/src/offline/store.ts`

**Interfaces:**
- Consumes: `@capacitor/filesystem` (`Filesystem`, `Directory`, `Encoding`), `Capacitor.convertFileSrc`.
- Produces (tout async) :
  - `type OfflinePlay = { fountain: string; meta: PlayMeta }`
  - `type AudioManifest = { model?: string; settings?: VoiceSettings | null; map: Record<string, string> }` (`map`: nodeId → clé de cache)
  - `savePlay(slug, data: OfflinePlay): Promise<void>`
  - `loadPlay(slug): Promise<OfflinePlay | null>`
  - `saveNotes(slug, notes: Note[]): Promise<void>` / `loadNotes(slug): Promise<Note[]>`
  - `saveAudioManifest(slug, m: AudioManifest): Promise<void>` / `loadAudioManifest(slug): Promise<AudioManifest | null>`
  - `saveAudioClip(slug, key, bytesBase64: string): Promise<void>`
  - `audioClipUrl(slug, key): string` — URL WebView (`convertFileSrc`) du clip local.
  - `listLocalPlays(): Promise<{ slug: string; name: string }[]>`

Layout : `theatre/<slug>/play.json`, `notes.json`, `audio-manifest.json`, `audio/<key>.mp3`, sous `Directory.Data`.

- [ ] **Step 1: Implémenter `offline/store.ts`**

```ts
/** Persistance hors-ligne sur le FS natif (Capacitor). Non appelé en web (UI gated). */
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';
import type { Note, VoiceSettings } from '@theatre/core';
import type { PlayMeta } from '../api';

const DIR = Directory.Data;
const ROOT = 'theatre';
const playDir = (slug: string) => `${ROOT}/${slug}`;

export interface OfflinePlay {
  fountain: string;
  meta: PlayMeta;
}
export interface AudioManifest {
  model?: string;
  settings?: VoiceSettings | null;
  /** nodeId → clé de cache (nom du fichier `.mp3`). */
  map: Record<string, string>;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await Filesystem.mkdir({ path: path.split('/').slice(0, -1).join('/'), directory: DIR, recursive: true }).catch(() => {});
  await Filesystem.writeFile({ path, directory: DIR, encoding: Encoding.UTF8, data: JSON.stringify(value) });
}
async function readJson<T>(path: string): Promise<T | null> {
  try {
    const res = await Filesystem.readFile({ path, directory: DIR, encoding: Encoding.UTF8 });
    return JSON.parse(res.data as string) as T;
  } catch {
    return null;
  }
}

export const savePlay = (slug: string, data: OfflinePlay) => writeJson(`${playDir(slug)}/play.json`, data);
export const loadPlay = (slug: string) => readJson<OfflinePlay>(`${playDir(slug)}/play.json`);
export const saveNotes = (slug: string, notes: Note[]) => writeJson(`${playDir(slug)}/notes.json`, notes);
export const loadNotes = async (slug: string): Promise<Note[]> => (await readJson<Note[]>(`${playDir(slug)}/notes.json`)) ?? [];
export const saveAudioManifest = (slug: string, m: AudioManifest) => writeJson(`${playDir(slug)}/audio-manifest.json`, m);
export const loadAudioManifest = (slug: string) => readJson<AudioManifest>(`${playDir(slug)}/audio-manifest.json`);

export async function saveAudioClip(slug: string, key: string, bytesBase64: string): Promise<void> {
  const dir = `${playDir(slug)}/audio`;
  await Filesystem.mkdir({ path: dir, directory: DIR, recursive: true }).catch(() => {});
  // data (base64) sans encoding → Capacitor écrit des octets binaires.
  await Filesystem.writeFile({ path: `${dir}/${key}.mp3`, directory: DIR, data: bytesBase64 });
}

export function audioClipUrl(slug: string, key: string): string {
  // convertFileSrc a besoin du chemin absolu (uri) : résolu via getUri.
  // On mémorise l'uri racine au préalable (voir prepare.ts) ; ici on renvoie le chemin relatif
  // que l'appelant convertit avec getClipUri.
  return `${playDir(slug)}/audio/${key}.mp3`;
}

/** URI WebView réelle d'un clip (à await). */
export async function getClipUri(slug: string, key: string): Promise<string> {
  const { uri } = await Filesystem.getUri({ path: `${playDir(slug)}/audio/${key}.mp3`, directory: DIR });
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
  } catch {
    return [];
  }
}
```

> Note d'implémentation : l'API exacte de `@capacitor/filesystem` (types de retour de `readdir`, base64 binaire) se valide sur device en Task 7 ; ajuster `getClipUri`/`saveAudioClip` si l'API du plugin diffère (versions Capacitor). `audioClipUrl` est conservé pour le chemin relatif ; la lecture audio utilise `getClipUri` (async).

- [ ] **Step 2: Typecheck (après installation des deps Capacitor en Task 7)**

Run: `pnpm --filter @theatre/web typecheck`
Expected: 0 erreur. (Nécessite `@capacitor/filesystem` — voir Task 7. Si typecheck avant Task 7, installer d'abord : `pnpm --filter @theatre/web add @capacitor/filesystem`.)

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/offline/store.ts packages/web/package.json pnpm-lock.yaml
git commit -m "feat(web): store hors-ligne sur FS natif (pièce, notes, clips audio, manifeste)"
```

---

## Task 5: Manifeste audio + orchestration « Préparer hors-ligne »

Construit le manifeste `nodeId → key` avec la MÊME normalisation que la lecture (parité de clé), puis synchronise pièce + notes + clips vers le store.

**Files:**
- Create: `packages/web/src/offline/prepare.ts`
- Test: `packages/web/src/offline/prepare.test.ts`

**Interfaces:**
- Consumes: `parseFountain`, `buildNodeIds`, `speechTextForTts` (`@theatre/core`), `api.ttsBatch`, `api.fetchAudioByKey`, `offline/store`.
- Produces:
  - `buildAudioItems(fountain, characters, audio): { items: api.TtsBatchItem[]; nodeKeys: [] }` — en réalité renvoie `api.TtsBatchItem[]` avec `nodeId` = **vrai** nodeId (`buildNodeIds`), `text` = `speechTextForTts`, filtré aux persos ayant une voix. (Contraste avec `App.tsx` qui utilise un nodeId synthétique pour le seul comptage.)
  - `prepareOffline(play, notes, opts): Promise<{ prepared: number; skipped: number }>` — sync complète.

D'abord, ajouter à `api.ts` :
```ts
/** Télécharge un clip du cache serveur par clé (GET) → base64. */
export async function fetchAudioByKey(slug: string, key: string): Promise<string> {
  const res = await fetch(apiUrl(`/api/plays/${encodeURIComponent(slug)}/audio/${key}`));
  if (!res.ok) throw new Error(`clip ${key} indisponible (${res.status})`);
  const buf = await res.arrayBuffer();
  // base64 sans dépendance : via FileReader/btoa sur les octets.
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
```

- [ ] **Step 1: Écrire le test de parité (fonction pure)**

Créer `packages/web/src/offline/prepare.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { parseFountain, buildNodeIds, speechTextForTts } from '@theatre/core';
import { buildAudioItems } from './prepare';

const SRC = `# ACTE I.\n\n## SCENE I.\n\nMICHEL\nBonjour à tous.\n\nBENJI\nSalut Michel.\n`;

describe('buildAudioItems — parité nodeId/texte', () => {
  it('émet un item par tirade dont le perso a une voix, avec le vrai nodeId et le texte canonique', () => {
    const play = parseFountain(SRC, []);
    const ids = buildNodeIds(play);
    const michel = play.nodes.find((n) => n.type === 'line')!;
    const items = buildAudioItems(SRC, [], { voices: { [michel.type === 'line' ? michel.characterId : '']: 'v-michel' } });
    // MICHEL a une voix, BENJI non → 1 item
    expect(items).toHaveLength(1);
    const idx = play.nodes.indexOf(michel);
    expect(items[0].nodeId).toBe(ids[idx]);           // vrai nodeId (= data-nid du reader)
    expect(items[0].text).toBe(speechTextForTts(michel)); // texte canonique (parité de clé)
    expect(items[0].voiceId).toBe('v-michel');
  });
});
```

- [ ] **Step 2: Lancer → échec**

Run: `pnpm vitest run packages/web/src/offline/prepare.test.ts`
Expected: FAIL (`buildAudioItems` inexistant).

- [ ] **Step 3: Implémenter `prepare.ts`**

```ts
/** Construction du manifeste audio + synchronisation hors-ligne (cache-first). */
import { parseFountain, buildNodeIds, speechTextForTts, type AudioConfig, type Character, type Note } from '@theatre/core';
import * as api from '../api';
import * as store from './store';

/** Items /tts/batch avec le VRAI nodeId (buildNodeIds = data-nid) et le texte canonique. */
export function buildAudioItems(fountain: string, characters: Character[], audio: AudioConfig): api.TtsBatchItem[] {
  if (!audio.voices || !Object.keys(audio.voices).length) return [];
  const play = parseFountain(fountain, characters);
  const ids = buildNodeIds(play);
  const items: api.TtsBatchItem[] = [];
  play.nodes.forEach((n, i) => {
    if (n.type !== 'line') return;
    const voiceId = audio.voices?.[n.characterId];
    if (!voiceId) return;
    const text = speechTextForTts(n);
    if (!text) return;
    items.push({ nodeId: ids[i]!, text, voiceId });
  });
  return items;
}

export interface PreparePlay {
  slug: string;
  name: string;
  fountain: string;
  characters: Character[];
  template: import('@theatre/core').Template;
  audio: AudioConfig;
}

/** Synchronise pièce + notes + clips audio vers le FS natif. Cache-first, idempotent. */
export async function prepareOffline(
  play: PreparePlay,
  notes: Note[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ prepared: number; skipped: number }> {
  // 1) Texte + meta + notes.
  await store.savePlay(play.slug, {
    fountain: play.fountain,
    meta: { name: play.name, characters: play.characters, template: play.template, audio: play.audio },
  });
  await store.saveNotes(play.slug, notes);

  // 2) Audio : chauffe le cache serveur (batch) → obtient nodeId→key.
  const items = buildAudioItems(play.fountain, play.characters, play.audio);
  const map: Record<string, string> = {};
  let prepared = 0;
  let skipped = 0;
  const CHUNK = 10;
  for (let i = 0; i < items.length; i += CHUNK) {
    const chunk = items.slice(i, i + CHUNK);
    const { manifest } = await api.ttsBatch(play.slug, chunk, { model: play.audio.model, settings: play.audio.settings });
    for (const [nodeId, { key }] of Object.entries(manifest)) {
      try {
        const b64 = await api.fetchAudioByKey(play.slug, key);
        await store.saveAudioClip(play.slug, key, b64);
        map[nodeId] = key;
        prepared += 1;
      } catch {
        skipped += 1; // clip introuvable (pas de clé serveur) → on saute, sync partielle
      }
      onProgress?.(prepared + skipped, items.length);
    }
  }
  await store.saveAudioManifest(play.slug, { model: play.audio.model, settings: play.audio.settings ?? null, map });
  return { prepared, skipped };
}
```

- [ ] **Step 4: Lancer le test → succès**

Run: `pnpm vitest run packages/web/src/offline/prepare.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @theatre/web typecheck`
Expected: 0 erreur.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/offline/prepare.ts packages/web/src/offline/prepare.test.ts packages/web/src/api.ts
git commit -m "feat(web): manifeste audio (parité nodeId/texte) + sync hors-ligne cache-first"
```

---

## Task 6: Reader offline + mode natif dans `App.tsx`

Brancher : (a) `resolveAudio` lit le FS local quand un manifeste offline existe ; (b) en natif, l'app boote read-only, essaie le serveur, sinon liste/charge les pièces locales, et expose « Préparer hors-ligne ».

**Files:**
- Modify: `packages/web/src/components/Reader.tsx`
- Modify: `packages/web/src/App.tsx`

**Interfaces:**
- Consumes: `offline/store` (`loadAudioManifest`, `getClipUri`), `offline/prepare` (`prepareOffline`), `platform` (`isNative`, `getApiBase`, `setApiBase`).
- Produces: Reader accepte une prop optionnelle `offline?: { manifest: store.AudioManifest }` ; si présente, `resolveAudio` lit le clip local, sinon comportement serveur actuel.

- [ ] **Step 1: Reader — `resolveAudio` bascule online/offline**

Dans `packages/web/src/components/Reader.tsx` :
- Ajouter la prop `offline?: import('../offline/store').AudioManifest | null` à la signature (après `onOrphans`).
- Remplacer le corps de `resolveAudio` (lignes ~108-124) par :

```ts
  const offlineRef = useRef(offline);
  offlineRef.current = offline;

  const resolveAudio = useCallback(async (t: AudioTirade): Promise<string | null> => {
    const cfg = audioCfgRef.current;
    const voiceId = cfg.voices?.[t.characterId];
    if (!voiceId) return null;
    const cacheKey = `${t.nodeId}|${voiceId}`;
    const cached = urlCacheRef.current.get(cacheKey);
    if (cached) return cached;

    // Offline : clip local (FS natif) via la clé du manifeste.
    const off = offlineRef.current;
    if (off) {
      const key = off.map[t.nodeId];
      if (!key) return null;
      const url = await getClipUri(slugRef.current, key); // convertFileSrc(uri)
      urlCacheRef.current.set(cacheKey, url);
      return url;
    }

    // Online : synthèse serveur (blob).
    const blob = await api.tts(slugRef.current, { text: t.text, voiceId, model: cfg.model, settings: cfg.settings });
    const url = URL.createObjectURL(blob);
    urlCacheRef.current.set(cacheKey, url);
    return url;
  }, []);
```
- Importer `import { getClipUri } from '../offline/store';`.
- Dans le cleanup des object URLs (lignes ~127-133), ne révoquer que les URLs `blob:` (les URLs `capacitor://`/`file:` ne se révoquent pas) : `cache.forEach((u) => { if (u.startsWith('blob:')) URL.revokeObjectURL(u); });`.
- Ajouter `offline` aux deps du `useEffect` qui crée le player (ligne ~244) pour recréer le resolver si le mode change.

- [ ] **Step 2: App — plateforme + data source local-first en natif**

Dans `packages/web/src/App.tsx` :
- Importer `import { isNative, getApiBase, setApiBase } from './platform';`, `import { prepareOffline } from './offline/prepare';`, `import * as offlineStore from './offline/store';`.
- Ajouter les états : `const [offlineManifest, setOfflineManifest] = useState<offlineStore.AudioManifest | null>(null);` et `const [serverReachable, setServerReachable] = useState<boolean | null>(null);`.
- Au boot, en natif : forcer `mode='read'`, et si `getApiBase()` est vide, demander l'URL (voir Step 3). Charger la liste : essayer `api.listPlays()` (serveur) ; en cas d'échec, `offlineStore.listLocalPlays()`.
- `onSelect(slug)` en natif : si serveur injoignable, `offlineStore.loadPlay(slug)` + `offlineStore.loadNotes(slug)` + `offlineStore.loadAudioManifest(slug)` → alimente `play`, `notes`, `offlineManifest`. Si serveur joignable, comportement actuel + `offlineManifest=null`.
- Passer `offline={offlineManifest}` au `<Reader ... />` (ligne ~521).

```ts
useEffect(() => {
  if (!isNative()) return;
  setMode('read');
  (async () => {
    try {
      const plays = await api.listPlays();
      setServerReachable(true);
      setSummaries(plays);
    } catch {
      setServerReachable(false);
      setSummaries(await offlineStore.listLocalPlays());
    }
  })();
}, []);
```

- [ ] **Step 3: App — réglage de l'URL du Mac (premier lancement natif)**

Ajouter un petit champ (visible seulement si `isNative()`), pré-rempli par `getApiBase()`, qui appelle `setApiBase(v)` puis relance la liste. Placement : dans le `header`, à la place du sélecteur d'import (masqué en natif). Copie FR : placeholder `https://mon-mac.tailnet.ts.net`, libellé « Adresse du Mac (Tailscale) ».

- [ ] **Step 4: App — bouton « Préparer hors-ligne »**

Visible si `isNative() && serverReachable && play`. Réutilise la modale de progression existante (`AudioProgressModal`) ou un simple `busy` :

```ts
const onPrepareOffline = async () => {
  if (!play) return;
  setBusy('Préparation hors-ligne…');
  try {
    const { prepared, skipped } = await prepareOffline(
      { slug: play.slug, name: play.name, fountain: play.fountain, characters: play.characters, template: play.template, audio: play.audio },
      notes,
    );
    flash(`Hors-ligne prêt : ${prepared} clips${skipped ? `, ${skipped} manquants` : ''}.`);
  } catch (e) {
    flash(`Échec de la préparation : ${String(e)}`);
  } finally {
    setBusy(null);
  }
};
```
Ajouter le bouton dans le header (gated `isNative() && serverReachable`) et une commande palette « Préparer hors-ligne ».

- [ ] **Step 5: Typecheck + tests**

Run: `pnpm --filter @theatre/web typecheck && pnpm test`
Expected: 0 erreur ; tests verts.

- [ ] **Step 6: Vérif navigateur (web, non-régression)**

Le web (desktop) n'est PAS natif → `isNative()` faux → aucun changement de comportement (lecture en ligne inchangée). Vérifier via un script Playwright jetable sous `packages/server/` (cf. CLAUDE.md) : ouvrir `http://127.0.0.1:3001`, mode Lecture, cliquer une réplique, confirmer que l'audio serveur joue. Supprimer le script après.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/components/Reader.tsx packages/web/src/App.tsx
git commit -m "feat(web): reader audio offline (FS local) + mode natif local-first + Préparer hors-ligne"
```

---

## Task 7: Projet Capacitor iOS

Empaquette le build web dans une app iOS. Validation sur device (pas de test unitaire).

**Files:**
- Create: `packages/web/capacitor.config.ts`
- Modify: `packages/web/package.json` (deps + scripts)
- Generate: `packages/web/ios/` (`cap add ios`)

**Interfaces:**
- Produces: une app iOS installable qui charge le build web bundlé.

- [ ] **Step 1: Installer Capacitor**

Run:
```bash
pnpm --filter @theatre/web add @capacitor/core @capacitor/filesystem @capacitor/preferences
pnpm --filter @theatre/web add -D @capacitor/cli @capacitor/ios
```
Expected: deps ajoutées à `packages/web/package.json`.

- [ ] **Step 2: `capacitor.config.ts`**

Créer `packages/web/capacitor.config.ts` :
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

- [ ] **Step 3: Build web natif + scaffold iOS**

Le bundle natif doit être en mode read-only : le build web standard suffit (le read-only est piloté à l'exécution par `isNative()`). 

Run:
```bash
pnpm --filter @theatre/web build
cd packages/web && pnpm exec cap add ios && pnpm exec cap sync ios
```
Expected: `packages/web/ios/` créé ; `cap sync` copie `dist/` dans l'app.

- [ ] **Step 4: Scripts pnpm**

Ajouter à `packages/web/package.json` scripts :
```json
"cap:sync": "cap sync ios",
"cap:open": "cap open ios",
"ios": "vite build && cap sync ios && cap open ios"
```

- [ ] **Step 5: Gitignore du projet iOS généré**

Ajouter à `.gitignore` (via `.git/info/exclude` local si on ne veut pas committer) : `packages/web/ios/App/App/public/` (assets copiés) au minimum. Décision : committer `packages/web/ios/` (config Xcode) mais ignorer `ios/App/App/public/` (artefact de `cap sync`). Vérifier avec `git status` qu'aucun `dist/` volumineux n'est ajouté.

- [ ] **Step 6: Build & run sur device (Xcode)**

Run: `cd packages/web && pnpm exec cap open ios`
Dans Xcode : sélectionner l'équipe de signature (compte dev Apple), choisir le device, Run. 
Validation manuelle sur device :
1. Renseigner l'URL Tailscale du Mac au premier lancement.
2. Choisir une pièce (serveur joignable) → lecture + audio en ligne OK.
3. « Préparer hors-ligne » → message « Hors-ligne prêt : N clips ».
4. Couper le Wi-Fi / éteindre le serveur, relancer l'app → la pièce se charge depuis le FS, l'audio joue hors-ligne.

- [ ] **Step 7: Commit**

```bash
git add packages/web/capacitor.config.ts packages/web/package.json packages/web/ios .gitignore pnpm-lock.yaml
git commit -m "feat(ios): app Capacitor embarquant le reader web (offline-capable)"
```

---

## Task 8: Documentation (Tailscale + déploiement iOS)

**Files:**
- Modify: `README.md` (créer si absent) et/ou `CLAUDE.md`

- [ ] **Step 1: Rédiger la section Tailscale**

Ajouter une section « Lecteur mobile (iOS/Capacitor) » :
- Prérequis : Tailscale installé sur le Mac ET le téléphone, même tailnet.
- Exposer le serveur : `tailscale serve --bg 3001` (proxie `https://<mac>.ts.net` → `127.0.0.1:3001`). Vérifier `tailscale serve status`.
- Rappeler que Fastify reste sur `127.0.0.1` (Tailscale seul y accède).

- [ ] **Step 2: Rédiger le cycle de déploiement iOS**

- Livrer une nouvelle version du reader : `pnpm --filter @theatre/web ios` (build + sync + open) → Run dans Xcode sur le device.
- Le contenu (texte/notes/audio) NE nécessite PAS de rebuild : « Préparer hors-ligne » suffit, app connectée au Mac.

- [ ] **Step 3: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: setup Tailscale + cycle de déploiement du lecteur iOS Capacitor"
```

---

## Self-Review

**Spec coverage :**
- Endpoint `GET /audio/:key` → Task 1 ✓
- Retrait export + reader-runtime → Task 2 ✓
- Base URL configurable (natif ↔ Mac) → Task 3 ✓
- Store FS natif (pièce/notes/manifeste/clips) → Task 4 ✓
- Parité clé (speechTextForTts + buildNodeIds + format) + « Préparer hors-ligne » cache-first → Task 5 ✓
- Reader offline (FS) + mode natif read-only local-first → Task 6 ✓
- Projet Capacitor iOS + validation device → Task 7 ✓
- Doc Tailscale + déploiement → Task 8 ✓
- Jalon 2 (audio natif arrière-plan) → hors périmètre, plan séparé ✓

**Placeholders :** les parties non-testables par unité (FS Capacitor, iOS) sont explicitement validées sur device (Task 7) — ce n'est pas un placeholder mais un choix de validation assumé.

**Cohérence des types :** `AudioManifest.map` (nodeId→key) est produit par `prepareOffline` (Task 5) et consommé par `resolveAudio` offline (Task 6) via `off.map[t.nodeId]` ; `getClipUri(slug, key)` défini en Task 4, utilisé en Task 6. `apiUrl`/`getApiBase`/`setApiBase` définis en Task 3, utilisés partout. `buildAudioItems` renvoie `api.TtsBatchItem[]` (même type que `ttsBatch`). Cohérent.

## Points de vigilance (rappel spec)
- **ATS iOS** : valider que `https://<mac>.ts.net` passe sans exception (Task 7-6).
- **API `@capacitor/filesystem`** : ajuster `saveAudioClip`/`getClipUri` selon la version (base64 binaire, `readdir` shape) — validation device.
- **Perf Paged.js en WebView** : si lourd, optimiser le chemin reflow SANS créer un 2ᵉ reader (hors périmètre v1, à surveiller Task 7-6).
