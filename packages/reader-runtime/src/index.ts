/**
 * Runtime du lecteur mobile autonome (navigateur, vanilla, hors-ligne).
 *
 * Bundlé par esbuild (IIFE, globalName `TheatreReader`) et inliné dans le .html
 * exporté. Pilote le HTML rendu par @theatre/core en flux continu (reflow) :
 * surlignage multi-perso, mode « mes répliques », saut de scène, recherche,
 * taille de texte, et affichage des notes (figées) en lecture seule. Les données
 * arrivent par window.__THEATRE_READER_DATA__.
 */

import { decorate, annotationCss } from '@theatre/annotations';
import {
  createPlayer,
  type Player,
  type PlayerState,
  type ReadingSettings,
} from '@theatre/audio-player';
import type { Note } from '@theatre/core';
import { uiCss } from '@theatre/ui';

export interface ReaderData {
  characters: { id: string; name: string }[];
  toc: { id: string; label: string; scene: boolean }[];
  highlightsDefault: { characterId: string; color: string }[];
  notes?: Note[];
  storageKey: string;
  /** Audio embarqué (export opt-in) : nodeId -> data URI, + mon rôle. */
  audio?: { clips: Record<string, string>; myCharacterId?: string };
}

interface PersistedState {
  selected: string[]; // characterId[], l_ordre fixe les couleurs
  fontPct: number; // 100 = base
  reading: ReadingSettings; // réglages de répétition
  myRoles: string[]; // rôles joués (surcharge myCharacterId de l'export)
}

const PALETTE = ['#ffe08a', '#a8e6cf', '#b5d8ff', '#ffc9de', '#d6c8ff', '#ffd6a5'];
const FONT_MIN = 70;
const FONT_MAX = 220;

function colorFor(index: number): string {
  return PALETTE[index % PALETTE.length]!;
}

function boolOr(v: unknown, d: boolean): boolean {
  return typeof v === 'boolean' ? v : d;
}

function loadState(key: string, fallback: PersistedState): PersistedState {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedState>;
      const r = (parsed.reading ?? {}) as Partial<ReadingSettings>;
      return {
        selected: Array.isArray(parsed.selected) ? parsed.selected : fallback.selected,
        fontPct: typeof parsed.fontPct === 'number' ? parsed.fontPct : fallback.fontPct,
        reading: {
          rehearsal: boolOr(r.rehearsal, fallback.reading.rehearsal),
          mask: boolOr(r.mask, fallback.reading.mask),
          playMine: boolOr(r.playMine, fallback.reading.playMine),
          autoAdvance: boolOr(r.autoAdvance, fallback.reading.autoAdvance),
          tick: boolOr(r.tick, fallback.reading.tick),
        },
        myRoles: Array.isArray(parsed.myRoles)
          ? parsed.myRoles.filter((x): x is string => typeof x === 'string')
          : fallback.myRoles,
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

// Jetons + primitives de @theatre/ui : le lecteur mobile et l'app web partagent
// exactement le même CSS de base (cf. packages/ui/src/index.ts). esbuild inline
// la chaîne au bundle, le .html reste autonome.
const STYLE =
  uiCss +
  `
.reader-bar {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 10;
  display: flex; gap: var(--sp-2); padding: var(--sp-3); justify-content: center;
  background: var(--paper); border-top: 1px solid var(--rule);
  box-shadow: 0 -2px 12px rgba(0,0,0,.06);
  padding-bottom: max(var(--sp-3), env(safe-area-inset-bottom));
}
.reader-bar button {
  font: inherit; font-size: var(--fs-lg); padding: 10px 12px; min-width: var(--ctl-h-touch);
  border: 1px solid var(--rule); border-radius: var(--r-md); background: var(--paper-raised);
  color: var(--ink);
}
.reader-bar button[aria-pressed="true"] { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
.reader-sheet {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 20;
  max-height: 70vh; overflow: auto; padding: var(--sp-5) var(--sp-5) var(--sp-6);
  background: var(--paper); color: var(--ink);
  border-top-left-radius: var(--r-lg); border-top-right-radius: var(--r-lg);
  box-shadow: var(--sh-3); transform: translateY(110%);
  transition: transform .2s ease;
  padding-bottom: max(var(--sp-6), env(safe-area-inset-bottom));
}
.reader-sheet.open { transform: translateY(0); }
.reader-sheet h2 { margin: 0 0 var(--sp-4); font-size: 17px; }
.reader-sheet .row { display: block; padding: 12px 6px; border-bottom: 1px solid var(--rule); font-size: 16px; }
.reader-sheet .row input { margin-right: 10px; transform: scale(1.3); }
.reader-sheet .swatch { display: inline-block; width: 14px; height: 14px; border-radius: 3px; margin-left: 8px; vertical-align: middle; }
.reader-sheet .scene-link { color: inherit; text-decoration: none; }
.reader-sheet .scene-link.is-scene { padding-left: 18px; }
.reader-search { display: flex; gap: var(--sp-2); margin-bottom: var(--sp-4); }
.reader-search input { flex: 1; font: inherit; font-size: 16px; padding: 10px; border: 1px solid var(--rule); border-radius: var(--r-md); background: var(--paper-raised); color: var(--ink); }
.reader-backdrop { position: fixed; inset: 0; z-index: 15; background: var(--scrim); display: none; }
.reader-backdrop.open { display: block; }
.line--masked .speech { display: inline-block; filter: blur(5px); transition: filter .12s; cursor: pointer; }
.line--masked.line--revealed .speech { filter: none; }
.line-timer { display: block; height: 4px; margin: 0 0 6px; border-radius: 2px; background: color-mix(in srgb, var(--ink) 12%, transparent); overflow: hidden; }
.line-timer-fill { display: block; height: 100%; width: 0; background: var(--accent); border-radius: 2px; }
.reader-sheet .mode-hint { display: block; font-size: var(--fs-md); color: var(--ink-muted); margin: 4px 0 0 30px; }
.reader-sheet .mode-subhead { font-weight: 600; margin: var(--sp-5) 0 var(--sp-2); }
.reader-sheet .row input:disabled { opacity: .4; }
.mode-seg { display: flex; gap: var(--sp-2); margin-bottom: var(--sp-4); }
.mode-seg button { flex: 1; font: inherit; font-size: var(--fs-lg); padding: 10px; border: 1px solid var(--rule); border-radius: var(--r-md); background: var(--paper-raised); color: var(--ink); }
.mode-seg button[aria-pressed="true"] { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
mark.reader-hit { background: var(--hit); color: var(--hit-ink); }
mark.reader-hit--current { background: var(--hit-current); }
.line--speaking { outline: 2px solid var(--accent); outline-offset: 3px; border-radius: 4px; scroll-margin: 40vh; }
.play { padding-bottom: calc(96px + env(safe-area-inset-bottom)); }
`;

let selected: string[] = [];
let reading: ReadingSettings = { rehearsal: false, mask: true, playMine: false, autoAdvance: false, tick: false };
let myRoles: string[] = [];
let fontPct = 100;
let data: ReaderData;
let play: HTMLElement;
let key: string;
let player: Player | null = null;
let audioPlayBtn: HTMLButtonElement | null = null;
let lastPlayerState: PlayerState | null = null;
let hasClips = false;

function persist(): void {
  saveState(key, { selected, fontPct, reading, myRoles });
}

function applyFont(): void {
  fontPct = Math.min(FONT_MAX, Math.max(FONT_MIN, fontPct));
  play.style.fontSize = `${fontPct}%`;
}

function applyHighlights(): void {
  // Coloration des personnages sélectionnés (le masquage « répétition » est
  // désormais piloté par le moteur audio via le mode de lecture + mon rôle).
  const lines = play.querySelectorAll<HTMLElement>('.line');
  lines.forEach((line) => {
    const cid = line.getAttribute('data-cid');
    const idx = cid ? selected.indexOf(cid) : -1;
    line.style.backgroundColor = idx >= 0 ? colorFor(idx) : '';
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

function updateAudioBar(s: PlayerState): void {
  lastPlayerState = s;
  if (audioPlayBtn) audioPlayBtn.textContent = s.playing && !s.waitingForUser ? '⏸' : '▶';
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

function buildBar(
  openChars: () => void,
  openScenes: () => void,
  openSearch: () => void,
  openMode: () => void,
): void {
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
  const modeBtn = mk('Mode', openMode);
  modeBtn.setAttribute('aria-haspopup', 'dialog');
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
  // Transport audio (uniquement si des clips sont embarqués).
  if (hasClips) {
    audioPlayBtn = mk('▶', () => {
      if (!player) return;
      if (lastPlayerState?.waitingForUser) player.resume();
      else player.toggle();
    });
    mk('⏭', () => player?.next());
  }
  document.body.appendChild(bar);
}

function buildModeSheet(): () => void {
  const { sheet, open } = buildSheet('Mode de lecture');
  const subInputs: HTMLInputElement[] = [];

  // Interrupteur maître : Continu / Répétition.
  const setRehearsal = (on: boolean): void => {
    reading.rehearsal = on;
    player?.setSettings({ rehearsal: on });
    subInputs.forEach((i) => (i.disabled = !on));
    persist();
  };
  const seg = el('div', { class: 'mode-seg' });
  const segButtons: { on: boolean; btn: HTMLButtonElement }[] = [];
  const refreshSeg = (): void =>
    segButtons.forEach(({ on, btn }) => btn.setAttribute('aria-pressed', String(reading.rehearsal === on)));
  for (const m of [
    { on: false, label: 'Continu' },
    { on: true, label: 'Répétition' },
  ]) {
    const b = el('button', { type: 'button' }, m.label);
    b.addEventListener('click', () => {
      setRehearsal(m.on);
      refreshSeg();
    });
    segButtons.push({ on: m.on, btn: b });
    seg.appendChild(b);
  }
  refreshSeg();
  sheet.appendChild(seg);

  // Options de répétition (indépendantes).
  const opts: { key: keyof ReadingSettings; label: string; hint: string }[] = [
    { key: 'mask', label: 'Masquer mes répliques', hint: "Floutées jusqu'à ce qu'elles soient dites." },
    { key: 'playMine', label: 'Me faire répéter', hint: 'À la reprise, le TTS lit ma réplique.' },
    { key: 'autoAdvance', label: 'Avancement automatique', hint: 'Reprise auto après la durée, sans clic.' },
    { key: 'tick', label: "Bip quand c'est à moi", hint: '' },
  ];
  for (const o of opts) {
    const row = el('label', { class: 'row' });
    const cb = el('input', { type: 'checkbox' }) as HTMLInputElement;
    cb.checked = reading[o.key];
    cb.disabled = !reading.rehearsal;
    cb.addEventListener('change', () => {
      reading[o.key] = cb.checked;
      player?.setSettings({ [o.key]: cb.checked } as Partial<ReadingSettings>);
      persist();
    });
    subInputs.push(cb);
    row.appendChild(cb);
    row.appendChild(document.createTextNode(o.label));
    if (o.hint) row.appendChild(el('span', { class: 'mode-hint' }, o.hint));
    sheet.appendChild(row);
  }

  // Mes rôles (multi-sélection).
  sheet.appendChild(el('div', { class: 'mode-subhead' }, 'Mes rôles'));
  for (const ch of data.characters) {
    const row = el('label', { class: 'row' });
    const cb = el('input', { type: 'checkbox', value: ch.id }) as HTMLInputElement;
    cb.checked = myRoles.includes(ch.id);
    cb.addEventListener('change', () => {
      if (cb.checked) {
        if (!myRoles.includes(ch.id)) myRoles = [...myRoles, ch.id];
      } else {
        myRoles = myRoles.filter((r) => r !== ch.id);
      }
      player?.setRoles(myRoles);
      persist();
    });
    row.appendChild(cb);
    row.appendChild(document.createTextNode(ch.name));
    sheet.appendChild(row);
  }
  return open;
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
    reading: { rehearsal: false, mask: true, playMine: false, autoAdvance: false, tick: false },
    myRoles: d.audio?.myCharacterId ? [d.audio.myCharacterId] : [],
  };
  const state = loadState(key, defaults);
  selected = state.selected;
  fontPct = state.fontPct;
  reading = state.reading;
  myRoles = state.myRoles;
  hasClips = Boolean(d.audio && Object.keys(d.audio.clips).length);

  document.head.appendChild(el('style', {})).textContent = STYLE;
  backdrop = el('div', { class: 'reader-backdrop' });
  backdrop.addEventListener('click', closeSheets);
  document.body.appendChild(backdrop);

  play.addEventListener('click', (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return; // ex. clic sur un nœud texte
    const line = t.closest('.line') as HTMLElement | null;
    if (!line) return;
    const nid = line.getAttribute('data-nid');
    // Réplique masquée : un tap la révèle (peek), sans la jouer.
    if (line.classList.contains('line--masked')) {
      if (nid) player?.reveal(nid);
      return;
    }
    // Sinon : cliquer une réplique la joue (si audio embarqué).
    if (hasClips && nid) player?.playFrom(nid);
  });

  // Le moteur pilote le masquage « répétition » (réglages + rôles), même sans clips :
  // sans audio, on garde le déroulé + tap-to-peek ; avec audio, la répétition joue.
  player = createPlayer({
    container: play,
    resolveAudio: (t) => Promise.resolve(d.audio?.clips[t.nodeId] ?? null),
    roles: myRoles,
    settings: reading,
    onState: updateAudioBar,
    speakingClass: 'line--speaking',
  });

  buildBar(buildCharactersSheet(), buildScenesSheet(), buildSearchSheet(), buildModeSheet());
  applyFont();
  applyHighlights();

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
}

/** Bulle d'une note en lecture seule (mobile : pas de création/édition). */
function showNoteBubble(body: string): void {
  closeSheets();
  // Réutilise une bulle unique : sinon un .reader-sheet s'accumule à chaque clic.
  let sheet = document.getElementById('reader-note');
  if (!sheet) {
    sheet = el('div', { class: 'reader-sheet', id: 'reader-note' });
    sheet.appendChild(el('h2', {}, 'Note'));
    const p = el('p', { class: 'reader-note-body' });
    p.style.whiteSpace = 'pre-wrap';
    sheet.appendChild(p);
    document.body.appendChild(sheet);
  }
  sheet.querySelector<HTMLElement>('.reader-note-body')!.textContent = body;
  sheet.classList.add('open');
  backdrop.classList.add('open');
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
