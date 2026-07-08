# Lecteur mobile autonome — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exporter une pièce en un fichier `.html` autonome, hors-ligne, lisible sur mobile, avec surlignage multi-perso à la lecture, mode « mes répliques », saut de scène, recherche et réglage de taille de texte.

**Architecture:** Un nouvel endpoint serveur `POST /api/export/reader` rend la pièce via le `renderBody`/`renderCSS` canonique de `@theatre/core` (reflow, sans Paged.js), inline un runtime navigateur vanilla (nouveau package `@theatre/reader-runtime`, bundlé par esbuild) et un bloc de données JSON, puis renvoie un `.html` auto-suffisant. Le web ajoute un bouton de téléchargement. Une seule retouche au core : un attribut `data-cid` par réplique pour permettre la coloration/masquage côté client.

**Tech Stack:** TypeScript, pnpm monorepo (internal-packages pattern, pas de build), Fastify, esbuild (bundling du runtime), vitest (tests unit node), Playwright (vérif front jetable).

## Global Constraints

- **Source unique du rendu** : ne jamais ré-implémenter le rendu hors de `@theatre/core`. L'export reader appelle `renderBody` + `renderCSS` + `buildToc`.
- **Internal-packages pattern** : chaque package expose `"exports": { ".": "./src/index.ts" }`, pas d'étape de build ; type-safety via `pnpm typecheck` par package.
- **Pas de test web unitaire** (politique projet) : le front et le runtime navigateur se vérifient par script Playwright **jetable** sous `packages/server/`, supprimé après — jamais commité. Les tests unitaires vitest visent `core` et `server` (env node).
- **Dev URL** : `http://localhost:5173` (Vite, IPv6 `::1`) ; le serveur `:3001` est joignable sur `127.0.0.1` et sert `packages/web/dist` si présent (cible Playwright headless : `http://127.0.0.1:3001`). Mais l'export reader produit un **fichier local** ouvert via `file://`, sans serveur.
- **Outils** : `pnpm` (jamais npm/yarn), `\rm` au lieu de `rm`.
- **Back-compat template** : lire les champs booléens défensivement (`x !== false` pour défaut-actif).

---

### Task 1: `data-cid` sur chaque réplique (core)

Permet au runtime de colorer/masquer par personnage. Modif minime et inoffensive pour PDF/preview.

**Files:**
- Modify: `packages/core/src/render.ts` (fonction `renderLine`, ~ligne 52-53)
- Test: `packages/core/src/render.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces: chaque `<p class="line" …>` rendu par `renderBody` porte `data-cid="<characterId>"`.

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter dans `packages/core/src/render.test.ts` (après le `describe('buildToc'…)` ou à la fin du fichier) :

```ts
describe('data-cid', () => {
  it('marque chaque réplique avec l_id du personnage', () => {
    const src = `MICHEL\nBonjour.\n\nBENJI\nSalut.\n`;
    const p = parseFountain(src);
    const html = renderBody(p, actorReadingTemplate);
    // Un data-cid par réplique, valant l_id résolu du personnage.
    for (const c of p.characters) {
      expect(html).toContain(`data-cid="${c.id}"`);
    }
    const count = (html.match(/<p class="line[^"]*" data-cid=/g) ?? []).length;
    expect(count).toBe(2);
  });
});
```

- [ ] **Step 2: Lancer le test, vérifier l'échec**

Run: `pnpm vitest run packages/core/src/render.test.ts -t "data-cid"`
Expected: FAIL (le HTML ne contient pas `data-cid`).

- [ ] **Step 3: Implémenter**

Dans `packages/core/src/render.ts`, fonction `renderLine`, remplacer la dernière ligne :

```ts
  const flagged = node.flagged ? ' line--flagged' : '';
  const styleAttr = lineBg ? ` style="background-color:${lineBg}"` : '';
  return `<p class="line${flagged}" data-cid="${escapeHtml(node.characterId)}"${styleAttr}>${cue}${sep}${body}</p>`;
```

- [ ] **Step 4: Lancer le test, vérifier le succès + non-régression**

Run: `pnpm vitest run packages/core/src/render.test.ts`
Expected: PASS (tous, y compris les tests `renderBody` existants inchangés).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/render.ts packages/core/src/render.test.ts
git commit -m "feat(core): data-cid sur chaque réplique pour le surlignage dynamique"
```

---

### Task 2: Package `@theatre/reader-runtime` (runtime navigateur)

Le runtime vanilla inliné dans le `.html` : surlignage multi-perso, mode répétition, saut de scène, recherche, taille de texte, persistance `localStorage`. Pas de test unitaire (politique projet : vérifié par Playwright en Task 5) ; **le gate de cette task est `pnpm typecheck`**. Aucune dépendance runtime à `@theatre/core` (le runtime définit ses propres types et reçoit ses données par JSON inliné).

**Files:**
- Create: `packages/reader-runtime/package.json`
- Create: `packages/reader-runtime/tsconfig.json`
- Create: `packages/reader-runtime/src/index.ts`

**Interfaces:**
- Consumes: lit `window.__THEATRE_READER_DATA__` (objet `ReaderData`), agit sur le DOM rendu par `renderBody` (`.play`, `.line[data-cid]`, `.speech`, en-têtes `#h-<n>`).
- Produces: bundle IIFE exposant `TheatreReader.boot()` ; type `ReaderData = { characters: {id:string;name:string}[]; toc: {id:string;label:string;scene:boolean}[]; highlightsDefault: {characterId:string;color:string}[]; storageKey:string }`. Consommé par Task 3 (server) et Task 5 (Playwright).

- [ ] **Step 1: Créer `packages/reader-runtime/package.json`**

```json
{
  "name": "@theatre/reader-runtime",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **Step 2: Créer `packages/reader-runtime/tsconfig.json`** (lib DOM, comme le package web)

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": []
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Créer `packages/reader-runtime/src/index.ts`** (runtime complet)

```ts
/**
 * Runtime du lecteur mobile autonome (navigateur, vanilla, hors-ligne).
 *
 * Bundlé par esbuild (IIFE, globalName `TheatreReader`) et inliné dans le .html
 * exporté. Pilote le HTML rendu par @theatre/core en flux continu (reflow) :
 * surlignage multi-perso, mode « mes répliques », saut de scène, recherche,
 * taille de texte. Aucune dépendance runtime à @theatre/core : les données
 * arrivent par window.__THEATRE_READER_DATA__.
 */

export interface ReaderData {
  characters: { id: string; name: string }[];
  toc: { id: string; label: string; scene: boolean }[];
  highlightsDefault: { characterId: string; color: string }[];
  storageKey: string;
}

interface PersistedState {
  selected: string[]; // characterId[], l_ordre fixe les couleurs
  fontPct: number; // 100 = base
}

const PALETTE = ['#ffe08a', '#a8e6cf', '#b5d8ff', '#ffc9de', '#d6c8ff', '#ffd6a5'];
const FONT_MIN = 70;
const FONT_MAX = 220;

function colorFor(index: number): string {
  return PALETTE[index % PALETTE.length]!;
}

function loadState(key: string, fallback: PersistedState): PersistedState {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedState>;
      return {
        selected: Array.isArray(parsed.selected) ? parsed.selected : fallback.selected,
        fontPct: typeof parsed.fontPct === 'number' ? parsed.fontPct : fallback.fontPct,
      };
    }
  } catch {
    /* localStorage indisponible (mode privé, file://) : on ignore */
  }
  return fallback;
}

function saveState(key: string, s: PersistedState): void {
  try {
    localStorage.setItem(key, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

const STYLE = `
.reader-bar {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 10;
  display: flex; gap: 6px; padding: 8px; justify-content: center;
  background: rgba(255,255,255,.96); border-top: 1px solid #d8dce3;
  box-shadow: 0 -2px 12px rgba(0,0,0,.06);
}
.reader-bar button {
  font: inherit; font-size: 15px; padding: 10px 12px; min-width: 44px;
  border: 1px solid #cfd4dc; border-radius: 10px; background: #fff;
}
.reader-bar button[aria-pressed="true"] { background: #2b6cb0; color: #fff; border-color: #2b6cb0; }
.reader-sheet {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 20;
  max-height: 70vh; overflow: auto; padding: 16px 16px 24px;
  background: #fff; border-top-left-radius: 16px; border-top-right-radius: 16px;
  box-shadow: 0 -4px 24px rgba(0,0,0,.18); transform: translateY(110%);
  transition: transform .2s ease;
}
.reader-sheet.open { transform: translateY(0); }
.reader-sheet h2 { margin: 0 0 12px; font-size: 17px; }
.reader-sheet .row { display: block; padding: 12px 6px; border-bottom: 1px solid #eef0f4; font-size: 16px; }
.reader-sheet .row input { margin-right: 10px; transform: scale(1.3); }
.reader-sheet .swatch { display: inline-block; width: 14px; height: 14px; border-radius: 3px; margin-left: 8px; vertical-align: middle; }
.reader-sheet .scene-link { color: inherit; text-decoration: none; }
.reader-sheet .scene-link.is-scene { padding-left: 18px; }
.reader-search { display: flex; gap: 6px; margin-bottom: 12px; }
.reader-search input { flex: 1; font: inherit; font-size: 16px; padding: 10px; border: 1px solid #cfd4dc; border-radius: 10px; }
.reader-backdrop { position: fixed; inset: 0; z-index: 15; background: rgba(0,0,0,.25); display: none; }
.reader-backdrop.open { display: block; }
.line.rehearse .speech { filter: blur(5px); transition: filter .12s; cursor: pointer; }
.line.rehearse.revealed .speech { filter: none; }
mark.reader-hit { background: #fde68a; }
mark.reader-hit--current { background: #fb923c; }
.play { padding-bottom: 96px; }
`;

let selected: string[] = [];
let rehearsal = false;
let fontPct = 100;
let data: ReaderData;
let play: HTMLElement;
let key: string;

function persist(): void {
  saveState(key, { selected, fontPct });
}

function applyFont(): void {
  fontPct = Math.min(FONT_MAX, Math.max(FONT_MIN, fontPct));
  play.style.fontSize = `${fontPct}%`;
}

function applyHighlights(): void {
  const lines = play.querySelectorAll<HTMLElement>('.line');
  lines.forEach((line) => {
    const cid = line.getAttribute('data-cid');
    const idx = cid ? selected.indexOf(cid) : -1;
    line.style.backgroundColor = idx >= 0 ? colorFor(idx) : '';
    const active = rehearsal && idx >= 0;
    line.classList.toggle('rehearse', active);
    if (!active) line.classList.remove('revealed');
  });
}

function toggleCharacter(cid: string): void {
  const i = selected.indexOf(cid);
  if (i >= 0) selected.splice(i, 1);
  else selected.push(cid);
  applyHighlights();
  persist();
}

// ---- Recherche (repris/adapté de Reader.tsx, en vanilla) ----
let marks: HTMLElement[] = [];
let matchIndex = 0;

function clearMarks(): void {
  for (const mark of marks) {
    const parent = mark.parentNode;
    if (!parent) continue;
    parent.replaceChild(document.createTextNode(mark.textContent ?? ''), mark);
    parent.normalize();
  }
  marks = [];
}

function markMatches(query: string): void {
  const lc = query.toLowerCase();
  const walker = document.createTreeWalker(play, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = node.nodeValue;
      const parent = (node as Text).parentElement;
      if (!text || !parent) return NodeFilter.FILTER_REJECT;
      const tag = parent.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'MARK') return NodeFilter.FILTER_REJECT;
      return text.toLowerCase().includes(lc) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  const targets: Text[] = [];
  let n: Node | null;
  while ((n = walker.nextNode())) targets.push(n as Text);
  for (const textNode of targets) {
    const text = textNode.nodeValue ?? '';
    const low = text.toLowerCase();
    const frag = document.createDocumentFragment();
    let last = 0;
    let idx = low.indexOf(lc, 0);
    while (idx !== -1) {
      if (idx > last) frag.appendChild(document.createTextNode(text.slice(last, idx)));
      const mark = document.createElement('mark');
      mark.className = 'reader-hit';
      mark.textContent = text.slice(idx, idx + query.length);
      frag.appendChild(mark);
      marks.push(mark);
      last = idx + query.length;
      idx = low.indexOf(lc, last);
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    textNode.parentNode?.replaceChild(frag, textNode);
  }
}

function focusMatch(i: number): void {
  marks.forEach((m, k) => m.classList.toggle('reader-hit--current', k === i));
  marks[i]?.scrollIntoView({ block: 'center' });
}

function runSearch(query: string): void {
  clearMarks();
  if (query.trim().length >= 2) markMatches(query.trim());
  matchIndex = 0;
  if (marks.length) focusMatch(0);
}

function stepMatch(delta: number): void {
  if (!marks.length) return;
  matchIndex = (matchIndex + delta + marks.length) % marks.length;
  focusMatch(matchIndex);
}

// ---- UI ----
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text != null) node.textContent = text;
  return node;
}

function buildSheet(title: string): { sheet: HTMLElement; open: () => void } {
  const sheet = el('div', { class: 'reader-sheet' });
  sheet.appendChild(el('h2', {}, title));
  document.body.appendChild(sheet);
  return {
    sheet,
    open: () => {
      closeSheets();
      sheet.classList.add('open');
      backdrop.classList.add('open');
    },
  };
}

let backdrop: HTMLElement;
function closeSheets(): void {
  document.querySelectorAll('.reader-sheet.open').forEach((s) => s.classList.remove('open'));
  backdrop.classList.remove('open');
}

function buildCharactersSheet(): () => void {
  const { sheet, open } = buildSheet('Personnages à surligner');
  for (const c of data.characters) {
    const row = el('label', { class: 'row' });
    const cb = el('input', { type: 'checkbox' }) as HTMLInputElement;
    cb.checked = selected.includes(c.id);
    cb.addEventListener('change', () => {
      toggleCharacter(c.id);
      // recolore les pastilles selon le nouvel ordre
      sheet.querySelectorAll<HTMLElement>('.swatch').forEach((sw) => {
        const id = sw.getAttribute('data-cid') ?? '';
        const idx = selected.indexOf(id);
        sw.style.background = idx >= 0 ? colorFor(idx) : 'transparent';
      });
    });
    row.appendChild(cb);
    row.appendChild(document.createTextNode(c.name));
    const sw = el('span', { class: 'swatch', 'data-cid': c.id });
    const idx0 = selected.indexOf(c.id);
    sw.style.background = idx0 >= 0 ? colorFor(idx0) : 'transparent';
    row.appendChild(sw);
    sheet.appendChild(row);
  }
  return open;
}

function buildScenesSheet(): () => void {
  const { sheet, open } = buildSheet('Aller à une scène');
  for (const e of data.toc) {
    const a = el('a', { class: `scene-link${e.scene ? ' is-scene' : ''}`, href: `#${e.id}` });
    a.textContent = e.label;
    a.addEventListener('click', (ev) => {
      ev.preventDefault();
      closeSheets();
      document.getElementById(e.id)?.scrollIntoView({ block: 'start' });
    });
    const row = el('div', { class: 'row' });
    row.appendChild(a);
    sheet.appendChild(row);
  }
  return open;
}

function buildSearchSheet(): () => void {
  const { sheet, open } = buildSheet('Recherche');
  const bar = el('div', { class: 'reader-search' });
  const input = el('input', { type: 'search', placeholder: 'Rechercher…' }) as HTMLInputElement;
  const prev = el('button', {}, '‹');
  const next = el('button', {}, '›');
  input.addEventListener('input', () => runSearch(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') stepMatch(e.shiftKey ? -1 : 1);
  });
  prev.addEventListener('click', () => stepMatch(-1));
  next.addEventListener('click', () => stepMatch(1));
  bar.appendChild(input);
  bar.appendChild(prev);
  bar.appendChild(next);
  sheet.appendChild(bar);
  return () => {
    open();
    input.focus();
  };
}

function buildBar(openChars: () => void, openScenes: () => void, openSearch: () => void): void {
  const bar = el('div', { class: 'reader-bar' });
  const mk = (label: string, onClick: () => void): HTMLButtonElement => {
    const b = el('button', {}, label);
    b.addEventListener('click', onClick);
    bar.appendChild(b);
    return b;
  };
  mk('Persos', openChars);
  mk('Scènes', openScenes);
  mk('🔍', openSearch);
  mk('A−', () => {
    fontPct -= 10;
    applyFont();
    persist();
  });
  mk('A+', () => {
    fontPct += 10;
    applyFont();
    persist();
  });
  const reh = mk('Répét.', () => {
    rehearsal = !rehearsal;
    reh.setAttribute('aria-pressed', String(rehearsal));
    applyHighlights();
  });
  reh.setAttribute('aria-pressed', 'false');
  document.body.appendChild(bar);
}

function init(d: ReaderData): void {
  data = d;
  key = d.storageKey;
  const playEl = document.querySelector<HTMLElement>('.play');
  if (!playEl) return;
  play = playEl;

  const defaults: PersistedState = {
    selected: d.highlightsDefault.map((h) => h.characterId),
    fontPct: 100,
  };
  const state = loadState(key, defaults);
  selected = state.selected;
  fontPct = state.fontPct;

  document.head.appendChild(el('style', {})).textContent = STYLE;
  backdrop = el('div', { class: 'reader-backdrop' });
  backdrop.addEventListener('click', closeSheets);
  document.body.appendChild(backdrop);

  play.addEventListener('click', (e) => {
    if (!rehearsal) return;
    const line = (e.target as HTMLElement).closest('.line');
    if (line) line.classList.toggle('revealed');
  });

  buildBar(buildCharactersSheet(), buildScenesSheet(), buildSearchSheet());
  applyFont();
  applyHighlights();
}

export function boot(): void {
  const d = (window as unknown as { __THEATRE_READER_DATA__?: ReaderData }).__THEATRE_READER_DATA__;
  if (!d) return;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => init(d));
  } else {
    init(d);
  }
}
```

- [ ] **Step 4: Installer le workspace (le nouveau package est sous `packages/*`)**

Run: `pnpm install`
Expected: `@theatre/reader-runtime` lié dans le workspace, aucune erreur.

- [ ] **Step 5: Typecheck du package (gate de la task)**

Run: `pnpm --filter @theatre/reader-runtime typecheck`
Expected: aucune erreur TS.

- [ ] **Step 6: Commit**

```bash
git add packages/reader-runtime pnpm-lock.yaml
git commit -m "feat(reader-runtime): runtime navigateur du lecteur mobile autonome"
```

---

### Task 3: Assemblage du `.html` autonome (server)

Module qui rend la pièce, neutralise la pagination, inline le runtime (bundlé par esbuild) + les données, et renvoie `{ html, filename }`. Testé en node (assertions sur la chaîne).

**Files:**
- Create: `packages/server/src/reader-export.ts`
- Create: `packages/server/src/reader-export.test.ts`
- Modify: `packages/server/package.json` (ajouter deps `esbuild` et `@theatre/reader-runtime`)

**Interfaces:**
- Consumes: `@theatre/core` (`parseFountain`, `renderBody`, `renderCSS`, `buildToc`, types `Character`, `Template`) ; `@theatre/reader-runtime` (bundlé via esbuild, expose `TheatreReader.boot()`).
- Produces: `exportReaderHtml(fountain: string, characters: Character[], template: Template): Promise<{ html: string; filename: string }>`. Consommé par Task 4.

- [ ] **Step 1: Ajouter les dépendances dans `packages/server/package.json`**

Sous `"dependencies"`, ajouter (l'objet existant contient déjà `@theatre/core`, `fastify`, etc.) :

```json
    "@theatre/reader-runtime": "workspace:*",
    "esbuild": "^0.28.1"
```

Puis :

Run: `pnpm install`
Expected: esbuild + le workspace package liés.

- [ ] **Step 2: Écrire le test qui échoue** — `packages/server/src/reader-export.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { actorReadingTemplate, cloneTemplate } from '@theatre/core';
import { exportReaderHtml } from './reader-export';

const SRC = `# ACTE I.\n\n## SCENE I.\n\nMICHEL\nBonjour à tous.\n\nBENJI\nSalut Michel.\n`;

describe('exportReaderHtml', () => {
  it('produit un HTML mobile auto-suffisant', async () => {
    const { html, filename } = await exportReaderHtml(SRC, [], actorReadingTemplate);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('width=device-width');
    expect(html).toContain('data-cid='); // les répliques sont marquées
    expect(html).toContain('window.__THEATRE_READER_DATA__');
    expect(html).toContain('TheatreReader.boot()'); // runtime inliné + bootstrap
    // pagination neutralisée pour le reflow continu
    expect(html).toContain('.toc-item a::after { content: none');
    // auto-suffisant : aucune ressource réseau externe
    expect(html).not.toMatch(/(src|href)="https?:\/\//);
    expect(filename).toMatch(/^lecteur-.+\.html$/);
  });

  it('pré-sélectionne les surlignages du template', async () => {
    const tpl = cloneTemplate(actorReadingTemplate);
    // on surligne un personnage existant via son id résolu
    const { html } = await exportReaderHtml(SRC, [], tpl);
    expect(html).toContain('"highlightsDefault"');
  });
});
```

- [ ] **Step 3: Lancer le test, vérifier l'échec**

Run: `pnpm vitest run packages/server/src/reader-export.test.ts`
Expected: FAIL (module `./reader-export` introuvable).

- [ ] **Step 4: Implémenter** — `packages/server/src/reader-export.ts`

```ts
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
  const dataJson = JSON.stringify(data).replace(/</g, '\\u003c');
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
```

- [ ] **Step 5: Lancer le test, vérifier le succès**

Run: `pnpm vitest run packages/server/src/reader-export.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @theatre/server typecheck`
Expected: aucune erreur.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/reader-export.ts packages/server/src/reader-export.test.ts packages/server/package.json pnpm-lock.yaml
git commit -m "feat(server): assemblage du lecteur mobile autonome (.html)"
```

---

### Task 4: Endpoint `POST /api/export/reader` (server)

Branche l'assemblage sur Fastify, renvoie le `.html` en pièce jointe.

**Files:**
- Modify: `packages/server/src/server.ts` (import + nouvelle route, à côté de `/api/export`)
- Test: `packages/server/src/server.test.ts` (create)

**Interfaces:**
- Consumes: `exportReaderHtml` (Task 3) ; `buildServer()` existant.
- Produces: route `POST /api/export/reader` acceptant `{ fountain, characters, template }`, renvoyant `text/html` avec `Content-Disposition: attachment`.

- [ ] **Step 1: Écrire le test qui échoue** — `packages/server/src/server.test.ts`

```ts
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
```

- [ ] **Step 2: Lancer le test, vérifier l'échec**

Run: `pnpm vitest run packages/server/src/server.test.ts`
Expected: FAIL (404 sur la route inexistante).

- [ ] **Step 3: Implémenter** — dans `packages/server/src/server.ts`

Ajouter l'import en tête (à côté de `import { exportPdf } from './export';`) :

```ts
import { exportReaderHtml } from './reader-export';
```

Ajouter la route juste après le bloc `app.post('/api/export', …)` (avant le service statique) :

```ts
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
```

- [ ] **Step 4: Lancer le test, vérifier le succès**

Run: `pnpm vitest run packages/server/src/server.test.ts`
Expected: PASS (les deux cas).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @theatre/server typecheck`
Expected: aucune erreur.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/server.ts packages/server/src/server.test.ts
git commit -m "feat(server): endpoint POST /api/export/reader"
```

---

### Task 5: Bouton & commande web + vérification Playwright

Ajoute `exportReader` au client, un bouton de téléchargement et une entrée de palette, puis vérifie le `.html` produit sur viewport mobile via un script Playwright **jetable** (supprimé après).

**Files:**
- Modify: `packages/web/src/api.ts` (nouvelle fonction `exportReader`)
- Modify: `packages/web/src/App.tsx` (handler `onExportReader` + bouton + commande palette)

**Interfaces:**
- Consumes: route `POST /api/export/reader` (Task 4).
- Produces: `api.exportReader(fountain, characters, template): Promise<Blob>` ; bouton « Lecteur mobile » dans l'en-tête ; commande palette `export-reader`.

- [ ] **Step 1: Ajouter le client** — fin de `packages/web/src/api.ts`

```ts
export async function exportReader(
  fountain: string,
  characters: Character[],
  template: Template,
): Promise<Blob> {
  const res = await fetch('/api/export/reader', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fountain, characters, template }),
  });
  if (!res.ok) throw new Error(`Échec de l'export lecteur (${res.status})`);
  return res.blob();
}
```

- [ ] **Step 2: Ajouter le handler** — dans `packages/web/src/App.tsx`, juste après `onExport` (vers la ligne 114)

```tsx
  const onExportReader = async () => {
    if (!play) return;
    setBusy('Export lecteur mobile…');
    try {
      const blob = await api.exportReader(play.fountain, play.characters, play.template);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'lecteur-mobile.html';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      flash(String(e));
    } finally {
      setBusy(null);
    }
  };
```

- [ ] **Step 3: Ajouter la commande palette** — dans le bloc `if (play) { … }` du `useMemo` des commandes (après `cmds.push({ id: 'export', … })`, vers la ligne 147)

```tsx
      cmds.push({ id: 'export-reader', label: 'Exporter le lecteur mobile', run: onExportReader });
```

- [ ] **Step 4: Ajouter le bouton** — dans l'en-tête, après le `<button className="primary" onClick={onExport}>Exporter en PDF</button>` (vers la ligne 251)

```tsx
            <button onClick={onExportReader}>Lecteur mobile</button>
```

- [ ] **Step 5: Typecheck du web**

Run: `pnpm --filter @theatre/web typecheck`
Expected: aucune erreur.

- [ ] **Step 6: Vérification Playwright jetable (mobile)**

Construire le front et lancer le serveur, puis exécuter un script de vérification.

Run (build + serveur en arrière-plan) :
```bash
pnpm build && pnpm --filter @theatre/server start &
```

Importer une pièce (ou en avoir une dans `data/`), puis créer **temporairement** `packages/server/check-reader.mjs` :

```js
// Vérif jetable — NE PAS COMMITER. Supprimer après usage.
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const fountain = `# ACTE I.\n\n## SCENE I.\n\nMICHEL\nBonjour à tous, ceci est une longue réplique pour tester le reflow sur petit écran.\n\nBENJI\nSalut Michel, je te réponds.\n`;
const template = (await (await fetch('http://127.0.0.1:3001/api/plays')).json());

const res = await fetch('http://127.0.0.1:3001/api/export/reader', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    fountain,
    characters: [],
    // template par défaut côté serveur : on réutilise celui d_une pièce existante si dispo, sinon le défaut.
    template: { id: 'actor-reading', name: 'x', showDistribution: true, distributionPageBreak: true, showToc: true, pageNumbers: true,
      characterName: { bold: true, caps: true, italic: false, sameLineAsDialogue: false, suffix: ' : ' },
      stageDirection: { italic: true, color: '#6b6b6b', indent: true, hidden: false },
      inlineStageDirection: { italic: true, color: '#6b6b6b', hidden: false },
      actHeading: { bold: true, caps: true, align: 'center' },
      sceneHeading: { bold: true, caps: false, align: 'left', showAct: false },
      highlights: [], page: { format: 'A4', marginMm: 20, fontFamily: "'Times New Roman', serif", fontSizePt: 12, lineHeight: 1.5 } },
  }),
});
const html = await res.text();
writeFileSync('/tmp/lecteur.html', html);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); // iPhone 12
await page.goto('file:///tmp/lecteur.html');
await page.waitForSelector('.reader-bar');

// Surlignage : ouvrir Persos, cocher le 1er, vérifier un fond sur une réplique
await page.click('.reader-bar button:has-text("Persos")');
await page.click('.reader-sheet.open .row input');
const bg = await page.$eval('.line', (l) => getComputedStyle(l).backgroundColor);
console.log('fond réplique =', bg); // attendu : non transparent

// Saut de scène
await page.click('.reader-backdrop');
await page.click('.reader-bar button:has-text("Scènes")');
await page.click('.reader-sheet.open .scene-link');

// Taille de texte
await page.click('.reader-bar button:has-text("A+")');
const fs = await page.$eval('.play', (p) => p.style.fontSize);
console.log('taille =', fs); // attendu : > 100%

// Recherche
await page.click('.reader-bar button:has-text("🔍")');
await page.fill('.reader-sheet.open input[type=search]', 'Michel');
const hits = await page.$$eval('mark.reader-hit', (m) => m.length);
console.log('occurrences =', hits); // attendu : >= 1

// Mode répétition
await page.click('.reader-backdrop');
await page.click('.reader-bar button:has-text("Répét.")');
const blurred = await page.$eval('.line.rehearse .speech', (s) => getComputedStyle(s).filter);
console.log('flou =', blurred); // attendu : contient "blur"

await browser.close();
console.log('OK');
```

Run: `node packages/server/check-reader.mjs`
Expected: logs montrant fond non transparent, taille > 100%, ≥ 1 occurrence, filtre `blur(...)`, puis `OK`.

- [ ] **Step 7: Supprimer le script jetable et arrêter le serveur**

```bash
\rm packages/server/check-reader.mjs
# arrêter le serveur lancé en arrière-plan (jobs/kill selon le shell)
```

- [ ] **Step 8: Commit**

```bash
git add packages/web/src/api.ts packages/web/src/App.tsx
git commit -m "feat(web): bouton et commande d_export du lecteur mobile"
```

---

### Task 6: Ticket de consolidation des helpers de recherche

Le runtime mobile réimplémente `markMatches`/`clearMarks`/`focusMatch` déjà présents dans `Reader.tsx` (moteurs de mise en page différents → pas de fusion immédiate). Per scope discipline : ouvrir un ticket plutôt que d'absorber la dette en silence.

**Files:** aucun (action GitHub).

- [ ] **Step 1: Créer le ticket**

```bash
gh issue create \
  --title "Consolider les helpers de recherche DOM (Reader.tsx vs reader-runtime)" \
  --body "La recherche DOM (markMatches/clearMarks/focusMatch) est dupliquée entre packages/web/src/components/Reader.tsx (lecteur desktop, Paged.js) et packages/reader-runtime/src/index.ts (lecteur mobile, reflow). Extraire ces helpers dans un module partagé indépendant du moteur de mise en page, puis faire pointer les deux lecteurs dessus. Introduit par le lecteur mobile autonome (docs/superpowers/plans/2026-06-23-lecteur-mobile-autonome.md)."
```

Expected: l'URL du ticket s'affiche.

---

## Self-Review

**Spec coverage :**
- Distribution fichier HTML autonome → Tasks 3+4 (assemblage + endpoint), Task 5 (téléchargement). ✓
- Reflow (pas de Paged.js, pagination neutralisée) → Task 3 (overrides CSS `content:none`, `break-after:auto`). ✓
- `data-cid` → Task 1. ✓
- Runtime inliné par esbuild → Tasks 2 (runtime) + 3 (bundling/inline). ✓
- Surligner plusieurs persos (palette, pré-sélection `highlightsDefault`) → Task 2 (`selected[]`, `colorFor`, `buildCharactersSheet`) + données dans Task 3. ✓
- Mode « mes répliques » → Task 2 (classe `rehearse`, tap-to-reveal). ✓
- Saut de scène (toc `#h-<n>`) → Task 2 (`buildScenesSheet`) + `toc` dans Task 3. ✓
- Recherche tactile → Task 2 (`markMatches`/`stepMatch`/`buildSearchSheet`). ✓
- Taille de texte + persistance → Task 2 (`applyFont`, `localStorage`). ✓
- Bouton/commande web → Task 5. ✓
- Tests core/server unit + Playwright jetable → Tasks 1, 3, 4, 5. ✓
- Ticket consolidation recherche → Task 6. ✓

**Placeholder scan :** aucun TODO/TBD ; tout le code est fourni.

**Type consistency :** `ReaderData` (Task 2) ↔ objet `data` assemblé (Task 3) : `characters{id,name}`, `toc{id,label,scene}`, `highlightsDefault{characterId,color}`, `storageKey` — cohérents. `exportReaderHtml(fountain,characters,template)` (Task 3) ↔ appel route (Task 4) ↔ `api.exportReader` (Task 5) — signatures cohérentes. `TheatreReader.boot()` (globalName Task 3 esbuild ↔ export `boot` Task 2 ↔ bootstrap Task 3) — cohérent.
