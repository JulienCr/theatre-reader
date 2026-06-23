# Notes sur sélection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre, en mode aperçu et lecture de l'app web, de sélectionner des mots, voir un tooltip « ➕ Note », saisir une note libre ; les passages annotés sont surlignés et cliquables (voir/éditer/supprimer) ; un panneau liste toutes les notes (+ orphelines) ; le fichier mobile exporté affiche les notes en lecture seule.

**Architecture:** Le modèle `Note` et l'ancrage pur (`resolveNote`) vivent dans `@theatre/core`. Le rendu canonique émet `data-ni="<nodeIndex>"` sur chaque bloc annotable. Une nouvelle couche DOM sans framework, `@theatre/annotations`, décore les passages annotés et gère la création par sélection ; elle est partagée par l'app web (aperçu + lecteur, via un hook React) et le runtime mobile (lecture seule, bundlé par esbuild). Les notes sont persistées côté serveur dans `data/<slug>/notes.json` (endpoints dédiés) et inlinées figées dans l'export mobile.

**Tech Stack:** TypeScript, pnpm monorepo (internal-packages, pas de build), React/Vite (web), Fastify (server), esbuild (bundle runtime mobile), vitest (unit core/server + DOM via happy-dom pour `@theatre/annotations`), Playwright (vérif front jetable).

## Global Constraints

- **Source unique du rendu** : ne jamais ré-implémenter le rendu hors de `@theatre/core` (`renderBody`/`renderCSS`/`buildToc`).
- **Internal-packages pattern** : chaque package expose `"exports": { ".": "./src/index.ts" }`, pas d'étape de build ; type-safety via `pnpm typecheck` par package.
- **Ancrage choisi = « simple + orphelin »** : une note s'ancre par `nodeIndex` (index dans `play.nodes`) + `start`/`end` (décalages caractères dans le `textContent` du bloc) + `quote` (texte sélectionné). À la relecture, si `nodeText.slice(start,end) !== quote`, la note est **orpheline** (listée à part, jamais perdue). Pas de ré-ancrage flou.
- **Périmètre persistance** : création/édition/suppression dans l'**app web** (sauvegarde serveur). Le **`.html` mobile** affiche les notes existantes en **lecture seule** (figées dans l'export, pas de création).
- **Une note** = texte libre multi-ligne + `createdAt`/`updatedAt` ISO. Pas de catégories ni couleurs.
- **Pas de test web unitaire** (politique projet) : l'app web (React) et les parties interactives (sélection/tooltip/popover) se vérifient par script Playwright **jetable** sous `packages/server/`, supprimé après. Les fonctions DOM pures de `@theatre/annotations` (décoration/wrap) SONT testées avec `happy-dom`. Unit core/server en env node.
- **Outils** : `pnpm` (jamais npm/yarn), `\rm` au lieu de `rm`.
- **Dev** : front Vite sur `http://localhost:5173` ; serveur `:3001` joignable sur `127.0.0.1` et sert `packages/web/dist` si présent (cible Playwright : `http://127.0.0.1:3001`).
- **Back-compat** : `notes.json` absent ⇒ liste vide ; `ReaderData.notes` absent côté ancien export ⇒ runtime ne décore rien.

---

### Task 1: Modèle `Note` + ancrage pur (core)

**Files:**
- Create: `packages/core/src/notes.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/notes.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces: `interface Note { id: string; nodeIndex: number; start: number; end: number; quote: string; body: string; createdAt: string; updatedAt: string }` ; `resolveNote(nodeText: string, note: { start: number; end: number; quote: string }): { start: number; end: number } | null`. Réexportés depuis `@theatre/core`.

- [ ] **Step 1: Écrire le test qui échoue** — `packages/core/src/notes.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { resolveNote } from './notes';

describe('resolveNote', () => {
  const text = 'MICHEL : Bonjour à tous.';
  it('résout quand la citation correspond toujours', () => {
    // "Bonjour" commence à l'index 9
    expect(resolveNote(text, { start: 9, end: 16, quote: 'Bonjour' })).toEqual({ start: 9, end: 16 });
  });
  it('renvoie null (orphelin) si la citation ne correspond plus', () => {
    expect(resolveNote(text, { start: 9, end: 16, quote: 'Bonsoir' })).toBeNull();
  });
  it('renvoie null si les bornes sont hors limites ou vides', () => {
    expect(resolveNote(text, { start: 9, end: 99, quote: 'Bonjour' })).toBeNull();
    expect(resolveNote(text, { start: 9, end: 9, quote: '' })).toBeNull();
    expect(resolveNote(text, { start: -1, end: 3, quote: 'MIC' })).toBeNull();
  });
});
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `pnpm vitest run packages/core/src/notes.test.ts`
Expected: FAIL (module `./notes` introuvable).

- [ ] **Step 3: Implémenter** — `packages/core/src/notes.ts`

```ts
/**
 * Modèle d'une note utilisateur et son ancrage « simple + orphelin ».
 *
 * Une note s'accroche à un bloc rendu (réplique/didascalie/en-tête) repéré par
 * `nodeIndex` (index dans `play.nodes`, émis en `data-ni` par le rendu) et à une
 * plage de caractères [start, end) dans le `textContent` de ce bloc. `quote`
 * mémorise le texte sélectionné : si à la relecture la plage ne redonne pas
 * `quote`, la note est « orpheline » (non perdue, listée à part). Aucun
 * ré-ancrage flou. Module pur, sans DOM ni I/O.
 */

export interface Note {
  id: string;
  /** Index du bloc dans play.nodes (≙ attribut data-ni du rendu). */
  nodeIndex: number;
  /** Décalages caractères dans le textContent du bloc. */
  start: number;
  end: number;
  /** Texte sélectionné, pour détecter l'orphelin. */
  quote: string;
  /** Texte libre de la note. */
  body: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Résout la plage d'une note contre le texte courant d'un bloc.
 * Renvoie `{ start, end }` si la citation correspond toujours, sinon `null`
 * (note orpheline).
 */
export function resolveNote(
  nodeText: string,
  note: { start: number; end: number; quote: string },
): { start: number; end: number } | null {
  if (note.start < 0 || note.end > nodeText.length || note.start >= note.end) return null;
  return nodeText.slice(note.start, note.end) === note.quote
    ? { start: note.start, end: note.end }
    : null;
}
```

- [ ] **Step 4: Exporter depuis l'index** — `packages/core/src/index.ts`, ajouter en fin :

```ts
export * from './notes';
```

- [ ] **Step 5: Lancer, vérifier le succès + non-régression**

Run: `pnpm vitest run packages/core/ && pnpm --filter @theatre/core typecheck`
Expected: PASS (tous), typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/notes.ts packages/core/src/notes.test.ts packages/core/src/index.ts
git commit -m "feat(core): modèle Note + resolveNote (ancrage simple + orphelin)"
```

---

### Task 2: `data-ni` sur chaque bloc annotable (core)

**Files:**
- Modify: `packages/core/src/render.ts` (`renderLine`, `renderNode`, `renderBody`)
- Test: `packages/core/src/render.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces: chaque bloc de corps rendu par `renderBody` (`<p class="line">`, `<p class="stage">`, `<h2 class="act">`, `<h3 class="scene">`) porte `data-ni="<index du nœud dans play.nodes>"`.

- [ ] **Step 1: Écrire le test qui échoue** — ajouter dans `packages/core/src/render.test.ts`

```ts
describe('data-ni', () => {
  it('numérote chaque bloc annotable par son index de nœud', () => {
    // nœuds : 0=acte, 1=scène, 2=didascalie, 3=réplique
    const src = `# ACTE I.\n\n## SCENE I.\n\nLe rideau se lève.\n\nMICHEL\nBonjour.\n`;
    const p = parseFountain(src);
    const html = renderBody(p, actorReadingTemplate);
    expect(html).toContain('class="act" id="h-0" data-ni="0"');
    expect(html).toContain('class="scene" id="h-1" data-ni="1"');
    expect(html).toMatch(/<p class="stage[^"]*" data-ni="2"/);
    expect(html).toMatch(/<p class="line[^"]*" data-cid="[^"]*" data-ni="3"/);
  });
});
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `pnpm vitest run packages/core/src/render.test.ts -t "data-ni"`
Expected: FAIL (pas de `data-ni`).

- [ ] **Step 3: Implémenter** — `packages/core/src/render.ts`

3a. `renderLine` : ajouter un paramètre `nodeIndex` et l'émettre. Remplacer la signature et la dernière ligne :

```ts
function renderLine(node: LineNode, play: Play, template: Template, nodeIndex: number): string {
```
puis la ligne de retour :
```ts
  const flagged = node.flagged ? ' line--flagged' : '';
  const styleAttr = lineBg ? ` style="background-color:${lineBg}"` : '';
  return `<p class="line${flagged}" data-cid="${escapeHtml(node.characterId)}" data-ni="${nodeIndex}"${styleAttr}>${cue}${sep}${body}</p>`;
```

3b. `renderNode` : ajouter `nodeIndex`, l'émettre sur `stage`, le passer à `renderLine` :

```ts
function renderNode(node: Node, play: Play, template: Template, nodeIndex: number): string {
  switch (node.type) {
    case 'act':
      return `<h2 class="act">${escapeHtml(node.label)}</h2>`;
    case 'scene':
      return `<h3 class="scene">${escapeHtml(node.label)}</h3>`;
    case 'stage': {
      if (template.stageDirection.hidden) return '';
      const flagged = node.flagged ? ' stage--flagged' : '';
      return `<p class="stage${flagged}" data-ni="${nodeIndex}">${escapeHtml(node.text)}</p>`;
    }
    case 'line':
      return renderLine(node, play, template, nodeIndex);
  }
}
```

3c. `renderBody` : émettre `data-ni` sur les en-têtes et passer `i` à `renderNode`. Remplacer le bloc de boucle :

```ts
    if (node.type === 'act') {
      if (!entry) continue; // acte masqué (suivi d'une scène en mode showAct)
      out.push(`<h2 class="act" id="${entry.id}" data-ni="${i}">${escapeHtml(node.label)}</h2>`);
    } else if (node.type === 'scene') {
      out.push(`<h3 class="scene" id="${entry!.id}" data-ni="${i}">${escapeHtml(entry!.label)}</h3>`);
    } else {
      out.push(renderNode(node, play, template, i));
    }
```

- [ ] **Step 4: Lancer, vérifier le succès + non-régression**

Run: `pnpm vitest run packages/core/ && pnpm --filter @theatre/core typecheck`
Expected: PASS (y compris les tests `data-cid` et `renderBody` existants), typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/render.ts packages/core/src/render.test.ts
git commit -m "feat(core): data-ni sur chaque bloc annotable (ancrage des notes)"
```

---

### Task 3: Package `@theatre/annotations` — décoration DOM

Couche DOM sans framework, partagée par l'app web et le runtime mobile. Cette task livre la **lecture/décoration** (résoudre + surligner + clic), testée avec `happy-dom`. La création (sélection→tooltip) est en Task 4.

**Files:**
- Create: `packages/annotations/package.json`
- Create: `packages/annotations/tsconfig.json`
- Create: `packages/annotations/src/index.ts`
- Create: `packages/annotations/src/decorate.test.ts`
- Modify: `package.json` (racine — ajouter `happy-dom` en devDependency)

**Interfaces:**
- Consumes: `@theatre/core` (`resolveNote`, type `Note`).
- Produces (exportés depuis `@theatre/annotations`) :
  - `annotationCss: string`
  - `clearAnnotations(container: HTMLElement): void`
  - `wrapOffsets(block: HTMLElement, start: number, end: number, noteId: string): HTMLElement[]`
  - `decorate(container: HTMLElement, notes: Note[], opts?: { onActivate?: (id: string, rect: DOMRect) => void }): { orphans: Note[] }`

- [ ] **Step 1: Créer `packages/annotations/package.json`**

```json
{
  "name": "@theatre/annotations",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@theatre/core": "workspace:*"
  }
}
```

- [ ] **Step 2: Créer `packages/annotations/tsconfig.json`** (lib DOM)

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

- [ ] **Step 3: Ajouter `happy-dom` à la racine** — dans `package.json` racine, sous `devDependencies`, ajouter :

```json
    "happy-dom": "^15.11.0"
```
puis :

Run: `pnpm install`
Expected: `@theatre/annotations` lié, `happy-dom` installé.

- [ ] **Step 4: Écrire le test qui échoue** — `packages/annotations/src/decorate.test.ts`

```ts
// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import type { Note } from '@theatre/core';
import { clearAnnotations, decorate, wrapOffsets } from './index';

function note(over: Partial<Note>): Note {
  return {
    id: 'n1', nodeIndex: 0, start: 0, end: 0, quote: '', body: 'x',
    createdAt: '', updatedAt: '', ...over,
  };
}

describe('@theatre/annotations', () => {
  let root: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML =
      '<div id="c"><p class="line" data-ni="0">MICHEL : Bonjour à tous.</p>' +
      '<p class="line" data-ni="1">BENJI : Salut.</p></div>';
    root = document.getElementById('c') as HTMLElement;
  });

  it('wrapOffsets enrobe la plage dans un <mark>', () => {
    const block = root.querySelector('[data-ni="0"]') as HTMLElement;
    const marks = wrapOffsets(block, 9, 16, 'n1'); // "Bonjour"
    expect(marks).toHaveLength(1);
    expect(marks[0]!.textContent).toBe('Bonjour');
    expect(marks[0]!.getAttribute('data-note-id')).toBe('n1');
    expect(block.textContent).toBe('MICHEL : Bonjour à tous.'); // texte inchangé
  });

  it('decorate surligne les notes résolues et appelle onActivate au clic', () => {
    let activated: string | null = null;
    const notes = [note({ id: 'a', nodeIndex: 0, start: 9, end: 16, quote: 'Bonjour' })];
    const { orphans } = decorate(root, notes, { onActivate: (id) => (activated = id) });
    expect(orphans).toHaveLength(0);
    const mark = root.querySelector('mark.note-anchor') as HTMLElement;
    expect(mark.textContent).toBe('Bonjour');
    mark.click();
    expect(activated).toBe('a');
  });

  it('classe orpheline une note dont la citation ne correspond plus', () => {
    const notes = [note({ id: 'b', nodeIndex: 0, start: 9, end: 16, quote: 'Bonsoir' })];
    const { orphans } = decorate(root, notes);
    expect(orphans.map((o) => o.id)).toEqual(['b']);
    expect(root.querySelector('mark.note-anchor')).toBeNull();
  });

  it('classe orpheline une note pointant un nodeIndex absent', () => {
    const notes = [note({ id: 'c', nodeIndex: 99, start: 0, end: 3, quote: 'XXX' })];
    expect(decorate(root, notes).orphans.map((o) => o.id)).toEqual(['c']);
  });

  it('clearAnnotations retire les marques et restaure le texte', () => {
    decorate(root, [note({ id: 'a', nodeIndex: 0, start: 9, end: 16, quote: 'Bonjour' })]);
    clearAnnotations(root);
    expect(root.querySelector('mark.note-anchor')).toBeNull();
    expect((root.querySelector('[data-ni="0"]') as HTMLElement).textContent).toBe('MICHEL : Bonjour à tous.');
  });

  it('re-décorer ne cumule pas les marques', () => {
    const notes = [note({ id: 'a', nodeIndex: 0, start: 9, end: 16, quote: 'Bonjour' })];
    decorate(root, notes);
    decorate(root, notes);
    expect(root.querySelectorAll('mark.note-anchor')).toHaveLength(1);
  });
});
```

- [ ] **Step 5: Lancer, vérifier l'échec**

Run: `pnpm vitest run packages/annotations/src/decorate.test.ts`
Expected: FAIL (module `./index` introuvable).

- [ ] **Step 6: Implémenter** — `packages/annotations/src/index.ts`

```ts
/**
 * Couche d'annotation DOM, sans framework — partagée par l'app web (aperçu +
 * lecteur) et le runtime mobile en lecture seule.
 *
 * Décore les passages annotés : pour chaque note, retrouve le bloc `[data-ni]`,
 * résout sa plage via le `resolveNote` de @theatre/core, et enrobe la plage
 * dans des `<mark class="note-anchor" data-note-id>`. La création par sélection
 * est dans `creation.ts`.
 */

import { resolveNote, type Note } from '@theatre/core';

export const annotationCss = `
mark.note-anchor {
  background: #fff3bf;
  border-bottom: 2px solid #f0b429;
  border-radius: 2px;
  cursor: pointer;
}
mark.note-anchor:hover { background: #ffe8a3; }
`;

const NOTE_ATTR = 'data-note-id';

/** Retire toutes les marques d'annotation et restaure le texte du conteneur. */
export function clearAnnotations(container: HTMLElement): void {
  const marks = container.querySelectorAll<HTMLElement>('mark.note-anchor');
  marks.forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  });
}

/**
 * Enrobe la plage [start, end) (décalages dans le textContent du bloc) dans un
 * ou plusieurs `<mark>` (un par nœud texte traversé, p.ex. à cheval sur la cue
 * et la réplique). Renvoie les marques créées.
 */
export function wrapOffsets(
  block: HTMLElement,
  start: number,
  end: number,
  noteId: string,
): HTMLElement[] {
  const texts: Text[] = [];
  const walker = block.ownerDocument.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let n: Node | null;
  while ((n = walker.nextNode())) texts.push(n as Text);

  const marks: HTMLElement[] = [];
  let acc = 0;
  for (const t of texts) {
    const nodeStart = acc;
    const nodeEnd = acc + t.data.length;
    acc = nodeEnd;
    const s = Math.max(start, nodeStart);
    const e = Math.min(end, nodeEnd);
    if (s >= e) continue;
    let piece = t;
    if (s > nodeStart) piece = piece.splitText(s - nodeStart); // piece démarre à s
    if (e < nodeEnd) piece.splitText(e - s); // piece couvre [s, e)
    const mark = block.ownerDocument.createElement('mark');
    mark.className = 'note-anchor';
    mark.setAttribute(NOTE_ATTR, noteId);
    piece.parentNode!.replaceChild(mark, piece);
    mark.appendChild(piece);
    marks.push(mark);
  }
  return marks;
}

/**
 * Décore le conteneur d'après les notes. Re-décorer est idempotent (on nettoie
 * d'abord). Renvoie les notes orphelines (bloc absent ou citation décrochée).
 */
export function decorate(
  container: HTMLElement,
  notes: Note[],
  opts: { onActivate?: (id: string, rect: DOMRect) => void } = {},
): { orphans: Note[] } {
  clearAnnotations(container);
  const orphans: Note[] = [];
  for (const note of notes) {
    const block = container.querySelector<HTMLElement>(`[data-ni="${note.nodeIndex}"]`);
    const range = block ? resolveNote(block.textContent ?? '', note) : null;
    if (!block || !range) {
      orphans.push(note);
      continue;
    }
    const marks = wrapOffsets(block, range.start, range.end, note.id);
    for (const mark of marks) {
      mark.addEventListener('click', (ev) => {
        ev.stopPropagation();
        opts.onActivate?.(note.id, mark.getBoundingClientRect());
      });
    }
  }
  return { orphans };
}
```

- [ ] **Step 7: Lancer, vérifier le succès + typecheck**

Run: `pnpm vitest run packages/annotations/ && pnpm --filter @theatre/annotations typecheck`
Expected: PASS (6 tests), typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add packages/annotations package.json pnpm-lock.yaml
git commit -m "feat(annotations): package de décoration DOM partagé (+ tests happy-dom)"
```

---

### Task 4: `@theatre/annotations` — création par sélection

Ajoute le tooltip « ➕ Note » sur fin de sélection dans un bloc `[data-ni]`. Interactif : gate = `pnpm typecheck` ; comportement vérifié par Playwright en Task 11.

**Files:**
- Create: `packages/annotations/src/creation.ts`
- Modify: `packages/annotations/src/index.ts` (réexport)

**Interfaces:**
- Consumes: rien (DOM + Selection API).
- Produces (exportés depuis `@theatre/annotations`) :
  - `interface AnchorDraft { nodeIndex: number; start: number; end: number; quote: string }`
  - `enableCreation(container: HTMLElement, opts: { onRequestCreate: (anchor: AnchorDraft, rect: DOMRect) => void }): () => void` (renvoie une fonction de nettoyage)

- [ ] **Step 1: Implémenter** — `packages/annotations/src/creation.ts`

```ts
/**
 * Création d'une note par sélection : à la fin d'une sélection contenue dans un
 * seul bloc `[data-ni]`, affiche un tooltip flottant « ➕ Note ». Au clic,
 * calcule l'ancre (nodeIndex + décalages dans le textContent du bloc + citation)
 * et la remonte via `onRequestCreate`. Interactif (Selection API) — vérifié par
 * Playwright, pas en unit.
 */

export interface AnchorDraft {
  nodeIndex: number;
  start: number;
  end: number;
  quote: string;
}

/** Bloc annotable ancêtre (`[data-ni]`) d'un nœud, borné au conteneur. */
function blockOf(container: HTMLElement, node: Node | null): HTMLElement | null {
  let el: HTMLElement | null =
    node && node.nodeType === Node.TEXT_NODE
      ? (node.parentElement as HTMLElement | null)
      : (node as HTMLElement | null);
  while (el && el !== container) {
    if (el.hasAttribute?.('data-ni')) return el;
    el = el.parentElement;
  }
  return null;
}

export function enableCreation(
  container: HTMLElement,
  opts: { onRequestCreate: (anchor: AnchorDraft, rect: DOMRect) => void },
): () => void {
  const doc = container.ownerDocument;
  const tip = doc.createElement('button');
  tip.type = 'button';
  tip.className = 'note-tip';
  tip.textContent = '➕ Note';
  Object.assign(tip.style, {
    position: 'absolute',
    display: 'none',
    zIndex: '60',
    padding: '4px 8px',
    font: '13px sans-serif',
    background: '#1f2937',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    boxShadow: '0 2px 8px rgba(0,0,0,.25)',
  });
  doc.body.appendChild(tip);

  let pending: AnchorDraft | null = null;
  const hide = () => {
    tip.style.display = 'none';
    pending = null;
  };

  const onEnd = () => {
    const sel = doc.defaultView?.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return hide();
    const range = sel.getRangeAt(0);
    const startBlock = blockOf(container, range.startContainer);
    const endBlock = blockOf(container, range.endContainer);
    if (!startBlock || startBlock !== endBlock) return hide();
    const quote = range.toString();
    if (!quote.trim()) return hide();
    const pre = doc.createRange();
    pre.selectNodeContents(startBlock);
    pre.setEnd(range.startContainer, range.startOffset);
    const start = pre.toString().length;
    pending = {
      nodeIndex: Number(startBlock.getAttribute('data-ni')),
      start,
      end: start + quote.length,
      quote,
    };
    const rect = range.getBoundingClientRect();
    const view = doc.defaultView!;
    tip.style.left = `${view.scrollX + rect.left + rect.width / 2 - 32}px`;
    tip.style.top = `${view.scrollY + rect.top - 38}px`;
    tip.style.display = 'block';
  };

  const deferEnd = () => setTimeout(onEnd, 0);
  // Empêche le tooltip de voler le focus / d'effacer la sélection.
  tip.addEventListener('mousedown', (e) => e.preventDefault());
  tip.addEventListener('click', () => {
    if (pending) {
      const rect = tip.getBoundingClientRect();
      opts.onRequestCreate(pending, rect);
    }
    const sel = doc.defaultView?.getSelection();
    sel?.removeAllRanges();
    hide();
  });
  container.addEventListener('mouseup', deferEnd);
  container.addEventListener('touchend', deferEnd);
  const onSelChange = () => {
    const sel = doc.defaultView?.getSelection();
    if (!sel || sel.isCollapsed) hide();
  };
  doc.addEventListener('selectionchange', onSelChange);

  return () => {
    container.removeEventListener('mouseup', deferEnd);
    container.removeEventListener('touchend', deferEnd);
    doc.removeEventListener('selectionchange', onSelChange);
    tip.remove();
  };
}
```

- [ ] **Step 2: Réexporter** — dans `packages/annotations/src/index.ts`, ajouter en fin :

```ts
export { enableCreation, type AnchorDraft } from './creation';
```

- [ ] **Step 3: Typecheck + non-régression unit**

Run: `pnpm --filter @theatre/annotations typecheck && pnpm vitest run packages/annotations/`
Expected: typecheck clean ; les tests de décoration passent toujours (6).

- [ ] **Step 4: Commit**

```bash
git add packages/annotations/src/creation.ts packages/annotations/src/index.ts
git commit -m "feat(annotations): création de note par sélection (tooltip)"
```

---

### Task 5: Stockage + endpoints des notes (server)

**Files:**
- Modify: `packages/server/src/storage.ts` (ajouter `loadNotes`/`saveNotes`)
- Modify: `packages/server/src/server.ts` (routes GET/PUT)
- Test: `packages/server/src/notes.test.ts` (create)

**Interfaces:**
- Consumes: `@theatre/core` (type `Note`).
- Produces:
  - `loadNotes(slug: string): Promise<Note[]>` (liste vide si pas de fichier)
  - `saveNotes(slug: string, notes: Note[]): Promise<void>` (écrit `data/<slug>/notes.json`)
  - Routes `GET /api/plays/:slug/notes` → `{ notes: Note[] }` ; `PUT /api/plays/:slug/notes` (body `{ notes: Note[] }`) → `{ ok: true }`, `400` si `notes` n'est pas un tableau.

- [ ] **Step 1: Écrire le test qui échoue** — `packages/server/src/notes.test.ts`

```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Note } from '@theatre/core';

// DATA_DIR est lu à l'import de storage : on fixe l'env AVANT l'import dynamique.
process.env.THEATRE_DATA_DIR = mkdtempSync(join(tmpdir(), 'theatre-notes-'));

const { buildServer } = await import('./server');
type App = Awaited<ReturnType<typeof buildServer>>;

const sample: Note[] = [
  { id: 'a', nodeIndex: 3, start: 0, end: 7, quote: 'Bonjour', body: 'plus fort', createdAt: '2026-06-23T00:00:00.000Z', updatedAt: '2026-06-23T00:00:00.000Z' },
];

describe('endpoints notes', () => {
  let app: App;
  beforeAll(async () => { app = await buildServer(); });
  afterAll(async () => { await app.close(); });

  it('GET renvoie [] quand aucune note', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/plays/inconnue/notes' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ notes: [] });
  });

  it('PUT puis GET fait un aller-retour des notes', async () => {
    const put = await app.inject({ method: 'PUT', url: '/api/plays/piece/notes', payload: { notes: sample } });
    expect(put.statusCode).toBe(200);
    const get = await app.inject({ method: 'GET', url: '/api/plays/piece/notes' });
    expect(get.json()).toEqual({ notes: sample });
  });

  it('PUT 400 si notes n_est pas un tableau', async () => {
    const res = await app.inject({ method: 'PUT', url: '/api/plays/piece/notes', payload: { notes: 'x' } });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `pnpm vitest run packages/server/src/notes.test.ts`
Expected: FAIL (routes absentes → 404 sur GET).

- [ ] **Step 3: Implémenter le stockage** — `packages/server/src/storage.ts`

Ajouter `Note` à l'import de `@theatre/core` (l'import existe : `import { Character, Template, slugify } from '@theatre/core';`) :
```ts
import { Character, Note, Template, slugify } from '@theatre/core';
```
Ajouter en fin de fichier :
```ts
/** Charge les notes d'une pièce (liste vide si le fichier n'existe pas). */
export async function loadNotes(slug: string): Promise<Note[]> {
  try {
    return JSON.parse(await readFile(join(DATA_DIR, slug, 'notes.json'), 'utf8')) as Note[];
  } catch {
    return [];
  }
}

/** Écrit les notes d'une pièce dans data/<slug>/notes.json. */
export async function saveNotes(slug: string, notes: Note[]): Promise<void> {
  const dir = join(DATA_DIR, slug);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'notes.json'), JSON.stringify(notes, null, 2), 'utf8');
}
```

- [ ] **Step 4: Implémenter les routes** — `packages/server/src/server.ts`

Étendre l'import storage existant :
```ts
import { listPlays, loadNotes, loadPlay, savePlay, saveNotes, uniqueSlug, PlayMeta } from './storage';
```
Ajouter, juste après la route `PUT /api/plays/:slug` (la sauvegarde de pièce) :
```ts
  app.get<{ Params: { slug: string } }>('/api/plays/:slug/notes', async (req) => ({
    notes: await loadNotes(req.params.slug),
  }));

  app.put<{ Params: { slug: string }; Body: { notes: unknown } }>(
    '/api/plays/:slug/notes',
    async (req, reply) => {
      const { notes } = req.body;
      if (!Array.isArray(notes)) return reply.code(400).send({ error: 'notes (tableau) requis' });
      await saveNotes(req.params.slug, notes as PlayMeta['characters'] extends never ? never : import('@theatre/core').Note[]);
      return { ok: true };
    },
  );
```
Note : si l'inline `import(...)` gêne le typecheck, ajouter en tête `import type { Note } from '@theatre/core';` et typer le body `Body: { notes: Note[] }` + `await saveNotes(req.params.slug, notes)` après le garde `Array.isArray`. Préférer cette forme :
```ts
  app.put<{ Params: { slug: string }; Body: { notes: Note[] } }>(
    '/api/plays/:slug/notes',
    async (req, reply) => {
      const { notes } = req.body;
      if (!Array.isArray(notes)) return reply.code(400).send({ error: 'notes (tableau) requis' });
      await saveNotes(req.params.slug, notes);
      return { ok: true };
    },
  );
```
avec en tête du fichier : `import type { Note } from '@theatre/core';`

- [ ] **Step 5: Lancer, vérifier le succès + typecheck**

Run: `pnpm vitest run packages/server/src/notes.test.ts && pnpm --filter @theatre/server typecheck`
Expected: PASS (3 tests), typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/storage.ts packages/server/src/server.ts packages/server/src/notes.test.ts
git commit -m "feat(server): stockage notes.json + endpoints GET/PUT /api/plays/:slug/notes"
```

---

### Task 6: Notes figées dans l'export mobile (server)

**Files:**
- Modify: `packages/server/src/reader-export.ts` (`exportReaderHtml` accepte `notes`, les inline)
- Modify: `packages/server/src/server.ts` (route `/api/export/reader` passe `notes`)
- Modify: `packages/server/src/reader-export.test.ts` (assertion notes)

**Interfaces:**
- Consumes: `@theatre/core` (type `Note`).
- Produces: `exportReaderHtml(fountain: string, characters: Character[], template: Template, notes?: Note[]): Promise<{ html: string; filename: string }>` — le bloc de données inliné contient `notes`. La route `/api/export/reader` lit `notes` du body (défaut `[]`).

- [ ] **Step 1: Écrire le test qui échoue** — ajouter dans `packages/server/src/reader-export.test.ts`

```ts
  it('inline les notes fournies (figées) dans le bloc de données', async () => {
    const notes = [
      { id: 'a', nodeIndex: 0, start: 0, end: 3, quote: 'MIC', body: 'note-test-xyz', createdAt: '', updatedAt: '' },
    ];
    const { html } = await exportReaderHtml(SRC, [], actorReadingTemplate, notes);
    expect(html).toContain('"notes"');
    expect(html).toContain('note-test-xyz');
  });
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `pnpm vitest run packages/server/src/reader-export.test.ts -t "inline les notes"`
Expected: FAIL (`exportReaderHtml` ignore les notes / signature à 3 args).

- [ ] **Step 3: Implémenter** — `packages/server/src/reader-export.ts`

Ajouter `Note` à l'import core :
```ts
import {
  buildToc,
  parseFountain,
  renderBody,
  renderCSS,
  type Character,
  type Note,
  type Template,
} from '@theatre/core';
```
Changer la signature et le `data` :
```ts
export async function exportReaderHtml(
  fountain: string,
  characters: Character[],
  template: Template,
  notes: Note[] = [],
): Promise<{ html: string; filename: string }> {
```
Dans l'objet `data`, ajouter le champ `notes` (après `highlightsDefault` ou `storageKey`) :
```ts
  const data = {
    characters: play.characters.map((c) => ({ id: c.id, name: c.canonicalName })),
    toc,
    highlightsDefault: template.highlights.map((h) => ({
      characterId: h.characterId,
      color: h.color,
    })),
    notes,
    storageKey: `theatre-reader:${slug}`,
  };
```

- [ ] **Step 4: Brancher la route** — `packages/server/src/server.ts`

Étendre `ExportBody` (interface en tête du fichier) :
```ts
interface ExportBody {
  fountain: string;
  characters: PlayMeta['characters'];
  template: PlayMeta['template'];
  notes?: Note[];
}
```
Dans la route `POST /api/export/reader`, passer `notes` :
```ts
    const { fountain, characters, template, notes } = req.body;
    if (typeof fountain !== 'string' || !template) {
      return reply.code(400).send({ error: 'fountain et template requis' });
    }
    const { html, filename } = await exportReaderHtml(fountain, characters ?? [], template, notes ?? []);
```

- [ ] **Step 5: Lancer, vérifier le succès + typecheck + non-régression**

Run: `pnpm vitest run packages/server/ && pnpm --filter @theatre/server typecheck`
Expected: PASS (tous les tests server, dont les 2 existants de reader-export), typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/reader-export.ts packages/server/src/server.ts packages/server/src/reader-export.test.ts
git commit -m "feat(server): inline les notes (figées) dans l'export lecteur mobile"
```

---

### Task 7: App web — client API, état, hook, popover, intégration aperçu

Première tranche verticale bout-en-bout dans l'aperçu : créer/voir/éditer/supprimer une note, persistée serveur, et surlignage. Gate = typecheck + build (politique : pas de test web unitaire ; comportement vérifié en Task 11).

**Files:**
- Modify: `packages/web/src/api.ts` (loadNotes/saveNotes)
- Create: `packages/web/src/useAnnotations.ts`
- Create: `packages/web/src/components/NotePopover.tsx`
- Modify: `packages/web/src/components/Preview.tsx`
- Modify: `packages/web/src/App.tsx` (état notes + persistance + passage à Preview)
- Modify: `packages/web/src/styles.css` (injecter `annotationCss` + style popover/tooltip)

**Interfaces:**
- Consumes: `@theatre/annotations` (`decorate`, `enableCreation`, `annotationCss`, `AnchorDraft`), `@theatre/core` (`Note`), endpoints Task 5.
- Produces:
  - `api.loadNotes(slug): Promise<Note[]>` ; `api.saveNotes(slug, notes): Promise<void>`
  - `useAnnotations(containerRef, notes, opts)` (hook)
  - `<NotePopover>` (composant)
  - `Preview` accepte `notes`, `editable`, `onCreate`, `onActivate`, `onOrphans`.

- [ ] **Step 1: Client API** — fin de `packages/web/src/api.ts`

```ts
import type { Note } from '@theatre/core';

export async function loadNotes(slug: string): Promise<Note[]> {
  const { notes } = await json<{ notes: Note[] }>(
    await fetch(`/api/plays/${encodeURIComponent(slug)}/notes`),
  );
  return notes;
}

export async function saveNotes(slug: string, notes: Note[]): Promise<void> {
  const res = await fetch(`/api/plays/${encodeURIComponent(slug)}/notes`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ notes }),
  });
  if (!res.ok) throw new Error(`Échec de la sauvegarde des notes (${res.status})`);
}
```
Note : `Type` import en haut du fichier s'il n'y est pas déjà — `api.ts` importe déjà `import type { Character, Template } from '@theatre/core';`, ajouter `Note` à cette ligne plutôt qu'un second import :
```ts
import type { Character, Note, Template } from '@theatre/core';
```
(et retirer le `import type { Note }` dupliqué ci-dessus si ajouté à la ligne existante.)

- [ ] **Step 2: Hook** — `packages/web/src/useAnnotations.ts`

```ts
/**
 * Câble la couche @theatre/annotations sur un conteneur rendu :
 * (re)décore quand les notes ou la clé de rendu changent, et active la création
 * par sélection quand `editable`. Les callbacks doivent être stables
 * (useCallback côté appelant) pour éviter des recalages superflus.
 */
import { useEffect, type RefObject } from 'react';
import { decorate, enableCreation, type AnchorDraft } from '@theatre/annotations';
import type { Note } from '@theatre/core';

export function useAnnotations(
  containerRef: RefObject<HTMLElement | null>,
  notes: Note[],
  opts: {
    editable: boolean;
    /** Change quand le HTML rendu change (re-décoration nécessaire). */
    redecorateKey: unknown;
    onActivate: (id: string, rect: DOMRect) => void;
    onRequestCreate: (anchor: AnchorDraft, rect: DOMRect) => void;
    onOrphans?: (orphans: Note[]) => void;
  },
): void {
  const { editable, redecorateKey, onActivate, onRequestCreate, onOrphans } = opts;

  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    const { orphans } = decorate(c, notes, { onActivate });
    onOrphans?.(orphans);
  }, [containerRef, notes, redecorateKey, onActivate, onOrphans]);

  useEffect(() => {
    const c = containerRef.current;
    if (!c || !editable) return;
    return enableCreation(c, { onRequestCreate });
  }, [containerRef, editable, redecorateKey, onRequestCreate]);
}
```

- [ ] **Step 3: Popover** — `packages/web/src/components/NotePopover.tsx`

```tsx
/**
 * Bulle d'une note, positionnée près du passage. Deux usages :
 * - création (note absente) : zone de texte + Enregistrer ;
 * - consultation/édition (note présente) : texte éditable + Enregistrer/Supprimer.
 * En lecture seule (editable=false), affiche seulement le texte.
 */
import { useEffect, useRef, useState } from 'react';
import type { Note } from '@theatre/core';

export interface PopoverTarget {
  note: Note | null; // null ⇒ création
  rect: DOMRect;
}

export function NotePopover({
  target,
  editable,
  onSave,
  onDelete,
  onClose,
}: {
  target: PopoverTarget;
  editable: boolean;
  onSave: (body: string) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [body, setBody] = useState(target.note?.body ?? '');
  const ref = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setBody(target.note?.body ?? '');
    if (editable) setTimeout(() => taRef.current?.focus(), 0);
  }, [target, editable]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const top = window.scrollY + target.rect.bottom + 6;
  const left = window.scrollX + target.rect.left;

  return (
    <div className="note-popover" ref={ref} style={{ top, left }}>
      {editable ? (
        <>
          <textarea
            ref={taRef}
            className="note-popover-text"
            value={body}
            placeholder="Votre note…"
            onChange={(e) => setBody(e.target.value)}
          />
          <div className="note-popover-actions">
            {target.note && (
              <button className="note-del" onClick={onDelete} title="Supprimer">
                Supprimer
              </button>
            )}
            <div className="spacer" />
            <button onClick={onClose}>Annuler</button>
            <button className="primary" disabled={!body.trim()} onClick={() => onSave(body.trim())}>
              Enregistrer
            </button>
          </div>
        </>
      ) : (
        <div className="note-popover-readonly">{target.note?.body}</div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Styles** — ajouter en fin de `packages/web/src/styles.css`

```css
/* Annotations : surlignage (importé de @theatre/annotations via JS), popover, tooltip. */
.note-popover {
  position: absolute;
  z-index: 70;
  width: 280px;
  max-width: 90vw;
  background: #fff;
  border: 1px solid #cfd4dc;
  border-radius: 10px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.18);
  padding: 10px;
}
.note-popover-text {
  width: 100%;
  min-height: 70px;
  resize: vertical;
  font: inherit;
  border: 1px solid #cfd4dc;
  border-radius: 6px;
  padding: 6px;
}
.note-popover-actions {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-top: 8px;
}
.note-popover-actions .spacer { flex: 1; }
.note-popover-readonly { white-space: pre-wrap; }
.note-del { color: #c92a2a; }
```

- [ ] **Step 5: Intégrer dans Preview** — remplacer `packages/web/src/components/Preview.tsx`

```tsx
/** Aperçu live : parse le Fountain et rend le même HTML/CSS que l'export PDF. */
import { useEffect, useMemo, useRef } from 'react';
import {
  parseFountain,
  renderBody,
  renderCSS,
  type Character,
  type Note,
  type Template,
} from '@theatre/core';
import { annotationCss, type AnchorDraft } from '@theatre/annotations';
import { useAnnotations } from '../useAnnotations';

export function Preview({
  fountain,
  characters,
  template,
  notes,
  editable,
  onActivate,
  onRequestCreate,
  onOrphans,
}: {
  fountain: string;
  characters: Character[];
  template: Template;
  notes: Note[];
  editable: boolean;
  onActivate: (id: string, rect: DOMRect) => void;
  onRequestCreate: (anchor: AnchorDraft, rect: DOMRect) => void;
  onOrphans?: (orphans: Note[]) => void;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const { css, body } = useMemo(() => {
    try {
      const play = parseFountain(fountain, characters);
      return { css: renderCSS(template), body: renderBody(play, template) };
    } catch (e) {
      return { css: '', body: `<p style="color:#b00">Erreur de rendu : ${String(e)}</p>` };
    }
  }, [fountain, characters, template]);

  // Injecte le CSS d'annotation une seule fois.
  useEffect(() => {
    const id = 'annotation-css';
    if (!document.getElementById(id)) {
      const style = document.createElement('style');
      style.id = id;
      style.textContent = annotationCss;
      document.head.appendChild(style);
    }
  }, []);

  useAnnotations(sheetRef, notes, {
    editable,
    redecorateKey: body,
    onActivate,
    onRequestCreate,
    onOrphans,
  });

  return (
    <div className="preview">
      <style>{css}</style>
      <div className="preview-sheet" ref={sheetRef} dangerouslySetInnerHTML={{ __html: body }} />
    </div>
  );
}
```

- [ ] **Step 6: État & persistance dans App** — `packages/web/src/App.tsx`

6a. Imports en tête (compléter la ligne core existante + ajouter le popover et le type AnchorDraft) :
```tsx
import { buildToc, parseFountain, type Character, type Note, type Template } from '@theatre/core';
import type { AnchorDraft } from '@theatre/annotations';
import { NotePopover, type PopoverTarget } from './components/NotePopover';
```

6b. États (après les `useState` existants, vers la ligne 31) :
```tsx
  const [notes, setNotes] = useState<Note[]>([]);
  const [orphans, setOrphans] = useState<Note[]>([]);
  const [popover, setPopover] = useState<{ target: PopoverTarget } | null>(null);
```

6c. Charger les notes à l'ouverture d'une pièce. Dans `onSelect`, après avoir `setPlay(...)`, ajouter :
```tsx
      setNotes(await api.loadNotes(slug).catch(() => []));
```
Et dans `onImport`, après `setPlay({...})`, ajouter `setNotes([]);`.

6d. Persistance + mutations (après `onSave`, vers la ligne 99) :
```tsx
  const persistNotes = async (next: Note[]) => {
    setNotes(next);
    if (play) await api.saveNotes(play.slug, next).catch((e) => flash(String(e)));
  };

  const onActivateNote = useCallback((id: string, rect: DOMRect) => {
    const note = notes.find((n) => n.id === id) ?? null;
    if (note) setPopover({ target: { note, rect } });
  }, [notes]);

  const onRequestCreate = useCallback((anchor: AnchorDraft, rect: DOMRect) => {
    const draftNote: Note = {
      id: crypto.randomUUID(),
      nodeIndex: anchor.nodeIndex,
      start: anchor.start,
      end: anchor.end,
      quote: anchor.quote,
      body: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setPopover({ target: { note: { ...draftNote }, rect } });
    pendingDraft.current = draftNote;
  }, []);

  const pendingDraft = useRef<Note | null>(null);

  const onPopoverSave = (body: string) => {
    const target = popover?.target;
    if (!target) return;
    const existing = target.note && notes.some((n) => n.id === target.note!.id);
    if (existing) {
      void persistNotes(
        notes.map((n) => (n.id === target.note!.id ? { ...n, body, updatedAt: new Date().toISOString() } : n)),
      );
    } else if (pendingDraft.current) {
      void persistNotes([...notes, { ...pendingDraft.current, body }]);
      pendingDraft.current = null;
    }
    setPopover(null);
  };

  const onPopoverDelete = () => {
    const id = popover?.target.note?.id;
    if (id) void persistNotes(notes.filter((n) => n.id !== id));
    setPopover(null);
  };
```
Ajouter `useCallback` et `useRef` aux imports React en tête s'ils manquent (le fichier importe déjà `useEffect, useMemo, useRef, useState` ; ajouter `useCallback`).

6e. Passer les props à `Preview` (remplacer le bloc `<Preview .../>`, vers la ligne 328) :
```tsx
            <Preview
              fountain={previewFountain}
              characters={play.characters}
              template={play.template}
              notes={notes}
              editable={true}
              onActivate={onActivateNote}
              onRequestCreate={onRequestCreate}
              onOrphans={setOrphans}
            />
```

6f. Rendre le popover (juste avant `<CommandPalette ... />`, vers la ligne 337) :
```tsx
      {popover && play && (
        <NotePopover
          target={popover.target}
          editable={mode !== 'read' || true}
          onSave={onPopoverSave}
          onDelete={onPopoverDelete}
          onClose={() => setPopover(null)}
        />
      )}
```
(`editable` est toujours vrai dans l'app web ; le mobile lecture seule est géré par le runtime, pas ce composant.) Simplifier en `editable={true}`.

- [ ] **Step 7: Typecheck + build**

Run: `pnpm --filter @theatre/web typecheck && pnpm build`
Expected: typecheck clean, build OK.

- [ ] **Step 8: Commit**

```bash
git add packages/web/src/api.ts packages/web/src/useAnnotations.ts packages/web/src/components/NotePopover.tsx packages/web/src/components/Preview.tsx packages/web/src/App.tsx packages/web/src/styles.css
git commit -m "feat(web): notes dans l'aperçu (sélection, popover, surlignage, persistance)"
```

---

### Task 8: App web — annotations dans le lecteur (Reader)

Le lecteur pagine avec Paged.js : la décoration doit tourner **après** pagination et se relancer quand les notes changent.

**Files:**
- Modify: `packages/web/src/components/Reader.tsx`
- Modify: `packages/web/src/App.tsx` (passer les props notes au Reader)

**Interfaces:**
- Consumes: `useAnnotations`, props notes/handlers de Task 7.
- Produces: `Reader` accepte `notes: Note[]`, `onActivate`, `onRequestCreate`, `onOrphans` et décore le DOM paginé.

- [ ] **Step 1: Étendre Reader** — `packages/web/src/components/Reader.tsx`

1a. Imports (compléter) :
```tsx
import { annotationCss, type AnchorDraft } from '@theatre/annotations';
import { useAnnotations } from '../useAnnotations';
import type { Note } from '@theatre/core';
```

1b. Props : ajouter au type de `Reader` (après `onToggleFullscreen`) :
```tsx
  notes: Note[];
  onActivate: (id: string, rect: DOMRect) => void;
  onRequestCreate: (anchor: AnchorDraft, rect: DOMRect) => void;
  onOrphans?: (orphans: Note[]) => void;
```
et les déstructurer dans la signature.

1c. Injecter le CSS d'annotation (une fois) — ajouter un effet près des autres :
```tsx
  useEffect(() => {
    const id = 'annotation-css';
    if (!document.getElementById(id)) {
      const style = document.createElement('style');
      style.id = id;
      style.textContent = annotationCss;
      document.head.appendChild(style);
    }
  }, []);
```

1d. Décorer après pagination : la pagination passe `status` à `'ready'` et `totalPages` est connu. Câbler le hook sur `containerRef` avec une clé de re-décoration qui change à chaque pagination :
```tsx
  useAnnotations(containerRef, notes, {
    editable: true,
    redecorateKey: `${status}:${totalPages}`,
    onActivate,
    onRequestCreate,
    onOrphans,
  });
```
Placer cet appel après les déclarations de `status`/`totalPages` (les hooks doivent rester à l'ordre stable, en haut du composant). Le `redecorateKey` change quand la pagination se termine (`status` → `ready`) ou re-pagine (`totalPages` varie), ce qui relance `decorate` sur le DOM paginé.

- [ ] **Step 2: Passer les props depuis App** — `packages/web/src/App.tsx`, dans le bloc `<Reader .../>` (vers la ligne 292) ajouter :
```tsx
            notes={notes}
            onActivate={onActivateNote}
            onRequestCreate={onRequestCreate}
            onOrphans={setOrphans}
```

- [ ] **Step 3: Typecheck + build**

Run: `pnpm --filter @theatre/web typecheck && pnpm build`
Expected: typecheck clean, build OK.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/Reader.tsx packages/web/src/App.tsx
git commit -m "feat(web): annotations dans le lecteur (décoration post-pagination)"
```

---

### Task 9: App web — panneau « Notes » (liste + orphelines + saut)

**Files:**
- Create: `packages/web/src/components/NotesPanel.tsx`
- Modify: `packages/web/src/App.tsx` (afficher le panneau dans la sidebar d'édition)
- Modify: `packages/web/src/styles.css` (style panneau)

**Interfaces:**
- Consumes: `notes`, `orphans` (App state), `onActivateNote`.
- Produces: `<NotesPanel notes orphans onJump />` où `onJump(note)` fait défiler jusqu'au passage (ou ouvre la note si orpheline).

- [ ] **Step 1: Composant** — `packages/web/src/components/NotesPanel.tsx`

```tsx
/** Panneau latéral : toutes les notes (passage cité + extrait), + orphelines. */
import type { Note } from '@theatre/core';

export function NotesPanel({
  notes,
  orphans,
  onJump,
}: {
  notes: Note[];
  orphans: Note[];
  onJump: (note: Note) => void;
}) {
  const orphanIds = new Set(orphans.map((o) => o.id));
  const active = notes.filter((n) => !orphanIds.has(n.id));
  return (
    <div className="notes-panel">
      <div className="pane-title">Notes ({notes.length})</div>
      {notes.length === 0 && <p className="notes-empty">Sélectionnez des mots pour annoter.</p>}
      <ul className="notes-list">
        {active.map((n) => (
          <li key={n.id} className="note-item" onClick={() => onJump(n)}>
            <span className="note-quote">« {n.quote} »</span>
            <span className="note-body">{n.body}</span>
          </li>
        ))}
      </ul>
      {orphans.length > 0 && (
        <>
          <div className="notes-subtitle">Orphelines ({orphans.length})</div>
          <ul className="notes-list">
            {orphans.map((n) => (
              <li key={n.id} className="note-item note-item--orphan" onClick={() => onJump(n)}>
                <span className="note-quote">« {n.quote} »</span>
                <span className="note-body">{n.body}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Styles** — ajouter en fin de `packages/web/src/styles.css`

```css
.notes-panel { margin-top: 1rem; }
.notes-empty { color: #868e96; font-size: 0.9em; }
.notes-list { list-style: none; margin: 0; padding: 0; }
.notes-subtitle { font-weight: bold; margin: 0.6em 0 0.3em; color: #c92a2a; }
.note-item { padding: 6px 8px; border-radius: 6px; cursor: pointer; }
.note-item:hover { background: #f1f3f5; }
.note-item--orphan { opacity: 0.8; }
.note-quote { display: block; font-style: italic; color: #495057; font-size: 0.85em; }
.note-body { display: block; white-space: pre-wrap; }
```

- [ ] **Step 3: Wiring dans App** — `packages/web/src/App.tsx`

3a. Import :
```tsx
import { NotesPanel } from './components/NotesPanel';
```

3b. Handler de saut (près des autres handlers de notes) :
```tsx
  const onJumpNote = (note: Note) => {
    const el = document.querySelector<HTMLElement>(`[data-note-id="${note.id}"]`)
      ?? document.querySelector<HTMLElement>(`[data-ni="${note.nodeIndex}"]`);
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } else if (mode === 'read') {
      navTo('entry', `h-${note.nodeIndex}`);
    }
  };
```

3c. Afficher le panneau dans la sidebar d'édition (après `<TemplatePanel ... />`, vers la ligne 311) :
```tsx
            <NotesPanel notes={notes} orphans={orphans} onJump={onJumpNote} />
```

- [ ] **Step 4: Typecheck + build**

Run: `pnpm --filter @theatre/web typecheck && pnpm build`
Expected: typecheck clean, build OK.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/NotesPanel.tsx packages/web/src/App.tsx packages/web/src/styles.css
git commit -m "feat(web): panneau Notes (liste, orphelines, saut au passage)"
```

---

### Task 10: Runtime mobile — affichage des notes en lecture seule

**Files:**
- Modify: `packages/reader-runtime/package.json` (dép `@theatre/annotations`)
- Modify: `packages/reader-runtime/src/index.ts` (type `ReaderData.notes` + décoration read-only)

**Interfaces:**
- Consumes: `@theatre/annotations` (`decorate`, `annotationCss`), données `data.notes` inlinées par Task 6.
- Produces: dans le `.html` mobile, les passages annotés sont surlignés ; un tap affiche le texte de la note en **lecture seule**. Pas de création/édition.

- [ ] **Step 1: Dépendance** — `packages/reader-runtime/package.json`, ajouter une section `dependencies` :

```json
  "dependencies": {
    "@theatre/annotations": "workspace:*"
  },
```
puis :

Run: `pnpm install`
Expected: lien workspace OK.

- [ ] **Step 2: Implémenter** — `packages/reader-runtime/src/index.ts`

2a. Import en tête :
```ts
import { decorate, annotationCss, type Note } from '@theatre/annotations';
```
Note : `Note` est réexporté par `@theatre/annotations` ? Non — il vient de `@theatre/core`. Importer le type depuis core n'ajoute pas de dépendance runtime (type-only, effacé par esbuild). Utiliser :
```ts
import { decorate, annotationCss } from '@theatre/annotations';
import type { Note } from '@theatre/core';
```
Pour que `@theatre/core` soit résolvable en type-only sans l'ajouter en dépendance runtime, ajouter `@theatre/core` en `devDependencies` du package reader-runtime :
dans `packages/reader-runtime/package.json`, ajouter :
```json
  "devDependencies": {
    "@theatre/core": "workspace:*"
  }
```
(et relancer `pnpm install`).

2b. Étendre l'interface `ReaderData` (ajouter `notes`) :
```ts
export interface ReaderData {
  characters: { id: string; name: string }[];
  toc: { id: string; label: string; scene: boolean }[];
  highlightsDefault: { characterId: string; color: string }[];
  notes?: Note[];
  storageKey: string;
}
```

2c. Décorer en lecture seule dans `init`, après `applyHighlights();` (fin de la fonction `init`). Ajouter :
```ts
  // Notes (figées dans l'export) : surlignage + bulle en lecture seule.
  if (d.notes && d.notes.length) {
    const noteStyle = el('style', {});
    noteStyle.textContent = annotationCss;
    document.head.appendChild(noteStyle);
    const byId = new Map(d.notes.map((n) => [n.id, n]));
    decorate(play, d.notes, {
      onActivate: (id) => showNoteBubble(byId.get(id)?.body ?? ''),
    });
  }
```

2d. Ajouter la bulle lecture seule (fonction module, près des autres helpers UI) :
```ts
function showNoteBubble(body: string): void {
  closeSheets();
  const sheet = el('div', { class: 'reader-sheet open' });
  sheet.appendChild(el('h2', {}, 'Note'));
  const p = el('p', {});
  p.textContent = body;
  p.style.whiteSpace = 'pre-wrap';
  sheet.appendChild(p);
  document.body.appendChild(sheet);
  backdrop.classList.add('open');
  // Le clic sur le backdrop ferme déjà toutes les .reader-sheet.open (closeSheets).
}
```
Note : `closeSheets()` retire la classe `open` mais ne supprime pas les feuilles éphémères. Pour éviter l'accumulation, après fermeture on peut laisser le DOM (faible volume). Acceptable v1.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @theatre/reader-runtime typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/reader-runtime/package.json packages/reader-runtime/src/index.ts pnpm-lock.yaml
git commit -m "feat(reader-runtime): affichage des notes en lecture seule (mobile)"
```

---

### Task 11: Vérification Playwright (web bout-en-bout + mobile lecture seule)

**Files:**
- Modify: `packages/web/src/App.tsx` (envoyer `notes` à l'export mobile)
- (throwaway) `packages/server/check-notes.mjs` — supprimé après, jamais commité.

**Interfaces:**
- Consumes: tout ce qui précède.
- Produces: l'export mobile inclut les notes courantes ; vérification manuelle automatisée.

- [ ] **Step 1: Envoyer les notes à l'export mobile** — `packages/web/src/api.ts`, modifier `exportReader` pour accepter et transmettre `notes` :

```ts
export async function exportReader(
  fountain: string,
  characters: Character[],
  template: Template,
  notes: Note[] = [],
): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch('/api/export/reader', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fountain, characters, template, notes }),
  });
  if (!res.ok) throw new Error(`Échec de l'export lecteur (${res.status})`);
  const disposition = res.headers.get('content-disposition') ?? '';
  const match = /filename="([^"]+)"/.exec(disposition);
  const filename = match?.[1] ?? 'lecteur-mobile.html';
  return { blob: await res.blob(), filename };
}
```
Et dans `packages/web/src/App.tsx`, `onExportReader`, passer les notes :
```tsx
      const { blob, filename } = await api.exportReader(play.fountain, play.characters, play.template, notes);
```

- [ ] **Step 2: Typecheck + build**

Run: `pnpm --filter @theatre/web typecheck && pnpm build`
Expected: clean.

- [ ] **Step 3: Lancer le serveur** (sert le front buildé sur `127.0.0.1:3001`)

```bash
pnpm --filter @theatre/server start &
```

- [ ] **Step 4: Script de vérification jetable** — créer `packages/server/check-notes.mjs` (NE PAS COMMITER)

```js
// Vérif jetable — NE PAS COMMITER. Supprimer après usage (\rm).
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const SCRATCH = '/private/tmp/claude-502/-Users-julien-cruau-dev2-theatre-reader/6088c89c-06f0-4d43-a05c-74f2e00deb11/scratchpad';
const base = 'http://127.0.0.1:3001';
const tpl = {
  id: 'actor-reading', name: 'x', showDistribution: true, distributionPageBreak: true, showToc: true, pageNumbers: true,
  characterName: { bold: true, caps: true, italic: false, sameLineAsDialogue: false, suffix: ' : ' },
  stageDirection: { italic: true, color: '#6b6b6b', indent: true, hidden: false },
  inlineStageDirection: { italic: true, color: '#6b6b6b', hidden: false },
  actHeading: { bold: true, caps: true, align: 'center' },
  sceneHeading: { bold: true, caps: false, align: 'left', showAct: false },
  highlights: [], page: { format: 'A4', marginMm: 20, fontFamily: "'Times New Roman', serif", fontSizePt: 12, lineHeight: 1.5 },
};
const note = {
  id: 'demo-1', nodeIndex: 0, start: 0, end: 7, quote: 'MICHEL\n', // sera ajusté ci-dessous
  body: 'note-mobile-xyz', createdAt: '', updatedAt: '',
};

// Export mobile avec une note ancrée sur "Bonjour" de la 1re réplique.
const fountain = `MICHEL\nBonjour à tous.\n\nBENJI\nSalut.\n`;
// node 0 = réplique MICHEL ; textContent = "MICHEL : Bonjour à tous." → "Bonjour" à l'index 9
const mobileNote = { ...note, nodeIndex: 0, start: 9, end: 16, quote: 'Bonjour' };
const res = await fetch(`${base}/api/export/reader`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ fountain, characters: [], template: tpl, notes: [mobileNote] }),
});
const html = await res.text();
writeFileSync(`${SCRATCH}/lecteur-notes.html`, html);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto(`file://${SCRATCH}/lecteur-notes.html`);
await page.waitForSelector('.reader-bar');

// Le passage est surligné (mark.note-anchor), tap → bulle lecture seule avec le texte.
const mark = await page.$('mark.note-anchor');
console.log('surlignage mobile présent =', Boolean(mark));
await mark.click();
const bubble = await page.waitForSelector('.reader-sheet.open');
const txt = await bubble.innerText();
console.log('bulle contient le texte =', txt.includes('note-mobile-xyz'));

await browser.close();
console.log('OK');
```

- [ ] **Step 5: Lancer la vérif mobile**

Run: `node packages/server/check-notes.mjs`
Expected: `surlignage mobile présent = true`, `bulle contient le texte = true`, `OK`.

- [ ] **Step 6: Vérif web manuelle (interactive)** — toujours via Playwright jetable, étendre le script ou l'exécuter séparément contre le front buildé (`http://127.0.0.1:3001`). Étapes à automatiser : ouvrir une pièce (via le sélecteur, en s'appuyant sur une pièce présente dans `data/`, ou importer), en mode aperçu sélectionner des mots dans un `.preview-sheet [data-ni]`, vérifier l'apparition du `button.note-tip`, cliquer, saisir un texte dans `.note-popover-text`, Enregistrer, puis vérifier qu'un `mark.note-anchor` apparaît et que `GET /api/plays/<slug>/notes` renvoie la note. Comme la sélection programmatique est délicate, il est acceptable de piloter la sélection via `page.evaluate` en construisant une `Range` + `getSelection().addRange(...)` puis en dispatchant un `mouseup` sur le conteneur.

Exécuter cette vérif web ; consigner dans le rapport les résultats observés (tooltip vu, note créée, surlignage présent, persistance confirmée). Si la sélection programmatique s'avère impraticable, le consigner et fournir à la place une vérification du chemin de décoration : injecter une note via `PUT /api/plays/<slug>/notes` puis recharger et vérifier le `mark.note-anchor` + le clic ouvrant `.note-popover`.

- [ ] **Step 7: Nettoyage**

```bash
\rm packages/server/check-notes.mjs
# arrêter le serveur lancé en arrière-plan
```

- [ ] **Step 8: Commit** (seulement la modif source de l'étape 1)

```bash
git add packages/web/src/api.ts packages/web/src/App.tsx
git commit -m "feat(web): joindre les notes courantes à l'export lecteur mobile"
```

---

## Self-Review

**Spec coverage :**
- Sélection → tooltip « ➕ Note » → saisie → Task 4 (`enableCreation`) + Task 7 (popover/persistance). ✓
- Marche en aperçu ET lecture → Task 7 (Preview) + Task 8 (Reader). ✓
- Ancrage simple + orphelin → Task 1 (`resolveNote`) + Task 2 (`data-ni`) + Task 3 (`decorate` renvoie `orphans`). ✓
- Texte libre + date auto → Task 1 (modèle) + Task 7 (`createdAt`/`updatedAt`, `crypto.randomUUID`). ✓
- Passage surligné + clic (voir/éditer/supprimer) → Task 3 (`decorate`/clic) + Task 7 (NotePopover éditer/supprimer). ✓
- Panneau liste + orphelines + saut → Task 9. ✓
- Persistance serveur (`notes.json`) → Task 5. ✓
- Mobile lecture seule (notes figées dans l'export) → Task 6 (inline) + Task 10 (décoration read-only) + Task 11 (envoi + vérif). ✓
- Réutilisation (couche partagée) → Task 3/4 `@theatre/annotations` consommé par web (7/8) et runtime (10). ✓
- Tests : unit core (1,2), unit annotations happy-dom (3), unit server (5,6), front Playwright jetable (11). ✓

**Placeholder scan :** aucun TODO/TBD ; tout le code est fourni. La Task 11 étape 6 décrit une vérif interactive avec une stratégie de repli explicite (pilotage de la sélection via `page.evaluate`), pas un placeholder.

**Type consistency :**
- `Note` (Task 1) identique partout (core, annotations import type, server, web, runtime).
- `resolveNote(nodeText, {start,end,quote})` (Task 1) ↔ appelé par `decorate` (Task 3) avec `block.textContent` + note. ✓
- `decorate(container, notes, {onActivate:(id,rect)=>void})` (Task 3) ↔ hook `useAnnotations` (Task 7) ↔ `onActivateNote(id,rect)` (App). ✓
- `enableCreation(container,{onRequestCreate:(anchor,rect)=>void})` (Task 4) ↔ `AnchorDraft{nodeIndex,start,end,quote}` ↔ `onRequestCreate` (App, Task 7) construit un `Note`. ✓
- `exportReaderHtml(fountain,characters,template,notes?)` (Task 6) ↔ route `/api/export/reader` (Task 6) ↔ `api.exportReader(...,notes)` (Task 11) ↔ `ReaderData.notes` (Task 10). ✓
- `data-ni="<i>"` (Task 2) ↔ sélecteur `[data-ni="${nodeIndex}"]` (Task 3 `decorate`, Task 4 `enableCreation`). ✓
- Endpoints `GET/PUT /api/plays/:slug/notes` (Task 5) ↔ `api.loadNotes/saveNotes` (Task 7). ✓
