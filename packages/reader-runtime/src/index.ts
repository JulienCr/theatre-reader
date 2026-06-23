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
.line.rehearse .speech { display: inline-block; filter: blur(5px); transition: filter .12s; cursor: pointer; }
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
