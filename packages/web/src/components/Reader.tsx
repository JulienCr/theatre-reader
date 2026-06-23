/**
 * Mode Lecteur plein écran : lecture en défilement continu avec repères de page.
 *
 * On pagine le MÊME rendu que l'export (renderBody + renderCSS) avec Paged.js
 * dans le navigateur → numéros de page identiques au PDF. Le style « feuille »
 * est aplati en CSS (cf. styles.css) et un repère « — page N — » sépare les pages.
 *
 * Tout au clavier : `/` recherche · `n`/`p` résultats · `+`/`-`/`0` zoom ·
 * `g` aller à la page · `f` plein écran · `?` aide · `Échap` ferme.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Previewer } from 'pagedjs';
import {
  buildToc,
  parseFountain,
  renderBody,
  renderCSS,
  type Character,
  type Template,
} from '@theatre/core';

type Status = 'paginating' | 'ready';

export interface NavTarget {
  kind: 'entry' | 'page';
  value: string | number;
  nonce: number;
}

const ZOOM_MIN = 0.6;
const ZOOM_MAX = 2.2;
const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 10) / 10));

export function Reader({
  fountain,
  characters,
  template,
  onClose,
  navTarget,
  isFullscreen,
  onToggleFullscreen,
}: {
  fountain: string;
  characters: Character[];
  template: Template;
  onClose: () => void;
  navTarget: NavTarget | null;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const pageRef = useRef<HTMLInputElement>(null);
  const marksRef = useRef<HTMLElement[]>([]);
  const matchIndexRef = useRef(0);

  const [status, setStatus] = useState<Status>('paginating');
  const [totalPages, setTotalPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [query, setQuery] = useState('');
  const [matchIndex, setMatchIndex] = useState(0);
  const [matchCount, setMatchCount] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [showHelp, setShowHelp] = useState(false);

  const play = useMemo(() => parseFountain(fountain, characters), [fountain, characters]);
  const toc = useMemo(() => buildToc(play, template), [play, template]);

  // Pagination (debounce) à l'ouverture et sur changement de contenu/template.
  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(async () => {
      const container = containerRef.current;
      if (!container) return;
      setStatus('paginating');
      clearMarks(marksRef.current);
      marksRef.current = [];
      container.innerHTML = '';
      try {
        const flow = await new Previewer().preview(
          renderBody(play, template),
          [{ template: renderCSS(template) }],
          container,
        );
        if (cancelled) return;
        setTotalPages(flow.total);
        setStatus('ready');
      } catch {
        if (!cancelled) setStatus('ready');
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [play, template]);

  const goToEntry = useCallback((id: string) => {
    containerRef.current?.querySelector(`[id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'start' });
  }, []);

  const goToPage = useCallback((n: number) => {
    if (!n || n < 1) return;
    containerRef.current
      ?.querySelector(`.pagedjs_page[data-page-number="${n}"]`)
      ?.scrollIntoView({ block: 'start' });
  }, []);

  // Suivi de la page courante (page la plus visible).
  useEffect(() => {
    if (status !== 'ready') return;
    const container = containerRef.current;
    if (!container) return;
    const pages = Array.from(container.querySelectorAll<HTMLElement>('.pagedjs_page'));
    if (!pages.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        const n = visible?.target.getAttribute('data-page-number');
        if (n) setCurrentPage(Number(n));
      },
      { root: container.closest('.reader-scroll'), threshold: [0.1, 0.5, 0.9] },
    );
    pages.forEach((p) => observer.observe(p));
    return () => observer.disconnect();
  }, [status, totalPages, zoom]);

  // Navigation pilotée de l'extérieur (command palette).
  useEffect(() => {
    if (status !== 'ready' || !navTarget) return;
    if (navTarget.kind === 'entry') goToEntry(String(navTarget.value));
    else goToPage(Number(navTarget.value));
  }, [navTarget, status, goToEntry, goToPage]);

  const step = useCallback((delta: number) => {
    const marks = marksRef.current;
    if (!marks.length) return;
    const next = (matchIndexRef.current + delta + marks.length) % marks.length;
    matchIndexRef.current = next;
    setMatchIndex(next);
    focusMatch(marks, next);
  }, []);

  const runSearch = (q: string) => {
    setQuery(q);
    const container = containerRef.current;
    if (!container) return;
    clearMarks(marksRef.current);
    const marks = q.trim().length >= 2 ? markMatches(container, q.trim()) : [];
    marksRef.current = marks;
    matchIndexRef.current = 0;
    setMatchCount(marks.length);
    setMatchIndex(0);
    if (marks.length) focusMatch(marks, 0);
  };

  // Raccourcis clavier globaux (pendant que le lecteur est ouvert).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);

      if (e.key === 'Escape') {
        if (showHelp) setShowHelp(false);
        else if (typing && target === searchRef.current) target.blur();
        else onClose();
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;

      // Aide : « ? » (ou Shift+/ selon le clavier).
      if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
        e.preventDefault();
        setShowHelp((h) => !h);
        return;
      }
      // Recherche : « / » sans Shift.
      if (e.key === '/' && !e.shiftKey) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }

      switch (e.key) {
        case 'n':
          step(1);
          break;
        case 'p':
        case 'N':
          step(-1);
          break;
        case '+':
        case '=':
          setZoom((z) => clampZoom(z + 0.1));
          break;
        case '-':
          setZoom((z) => clampZoom(z - 0.1));
          break;
        case '0':
          setZoom(1);
          break;
        case 'f':
          onToggleFullscreen();
          break;
        case 'g':
          e.preventDefault();
          pageRef.current?.focus();
          pageRef.current?.select();
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showHelp, step, onClose, onToggleFullscreen]);

  return (
    <div className="reader">
      <div className="reader-toolbar">
        <div className="reader-search">
          <input
            ref={searchRef}
            type="search"
            placeholder="Rechercher…  ( / )"
            value={query}
            onChange={(e) => runSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') step(e.shiftKey ? -1 : 1);
            }}
          />
          <span className="reader-count">
            {matchCount ? `${matchIndex + 1}/${matchCount}` : query.trim().length >= 2 ? '0' : ''}
          </span>
          <button title="Précédent (p)" onClick={() => step(-1)} disabled={!matchCount}>
            ‹
          </button>
          <button title="Suivant (n)" onClick={() => step(1)} disabled={!matchCount}>
            ›
          </button>
        </div>

        <select
          className="reader-goto"
          value=""
          onChange={(e) => e.target.value && goToEntry(e.target.value)}
        >
          <option value="">Aller à…</option>
          {toc.map((e) => (
            <option key={e.id} value={e.id}>
              {e.scene ? `  ${e.label}` : e.label}
            </option>
          ))}
        </select>

        <label className="reader-page">
          Page
          <input
            ref={pageRef}
            type="number"
            min={1}
            max={totalPages || 1}
            value={currentPage}
            onChange={(e) => {
              const n = Number(e.target.value);
              setCurrentPage(n);
              goToPage(n);
            }}
          />
          / {totalPages || '…'}
        </label>

        <label className="reader-zoom" title="Taille du texte ( + / - / 0 )">
          <span>A</span>
          <input
            type="range"
            min={ZOOM_MIN}
            max={ZOOM_MAX}
            step={0.1}
            value={zoom}
            onChange={(e) => setZoom(clampZoom(Number(e.target.value)))}
          />
          <span className="reader-zoom-big">A</span>
          <span className="reader-zoom-val">{Math.round(zoom * 100)}%</span>
        </label>

        <div className="spacer" />
        <button onClick={onToggleFullscreen} title="Plein écran (f)">
          {isFullscreen ? '⤢ Quitter' : '⤢ Plein écran'}
        </button>
        <button title="Raccourcis (?)" onClick={() => setShowHelp((h) => !h)}>
          ?
        </button>
        {status === 'paginating' && <span className="reader-status">Pagination…</span>}
      </div>

      <div className="reader-scroll">
        <div className="reader-pages" ref={containerRef} style={{ zoom }} />
        {status === 'paginating' && <div className="reader-overlay">Pagination en cours…</div>}
        {showHelp && <ShortcutsHelp onClose={() => setShowHelp(false)} />}
      </div>
    </div>
  );
}

function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ['/', 'Rechercher'],
    ['n  ·  p', 'Résultat suivant · précédent'],
    ['g', 'Aller à une page'],
    ['+  ·  -  ·  0', 'Zoom avant · arrière · réinitialiser'],
    ['f', 'Plein écran'],
    ['?', 'Afficher / masquer cette aide'],
    ['Échap', 'Fermer le lecteur'],
    ['⌘K  /  Ctrl+K', 'Palette de commandes'],
  ];
  return (
    <div className="help-overlay" onClick={onClose}>
      <div className="help-card" onClick={(e) => e.stopPropagation()}>
        <h3>Raccourcis clavier</h3>
        <dl>
          {rows.map(([k, d]) => (
            <div className="help-row" key={k}>
              <dt>
                <kbd>{k}</kbd>
              </dt>
              <dd>{d}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

/** Met en surbrillance et fait défiler le résultat courant. */
function focusMatch(marks: HTMLElement[], index: number) {
  marks.forEach((m, i) => m.classList.toggle('reader-hit--current', i === index));
  marks[index]?.scrollIntoView({ block: 'center' });
}

/** Restaure le texte des occurrences précédemment surlignées. */
function clearMarks(marks: HTMLElement[]) {
  for (const mark of marks) {
    const parent = mark.parentNode;
    if (!parent) continue;
    parent.replaceChild(document.createTextNode(mark.textContent ?? ''), mark);
    parent.normalize();
  }
}

/** Enrobe les occurrences de `query` dans des <mark>, renvoie la liste. */
function markMatches(root: HTMLElement, query: string): HTMLElement[] {
  const lcQuery = query.toLowerCase();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = node.nodeValue;
      const parent = (node as Text).parentElement;
      if (!text || !parent) return NodeFilter.FILTER_REJECT;
      const tag = parent.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'MARK') return NodeFilter.FILTER_REJECT;
      return text.toLowerCase().includes(lcQuery)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });
  const targets: Text[] = [];
  let n: Node | null;
  while ((n = walker.nextNode())) targets.push(n as Text);

  const marks: HTMLElement[] = [];
  for (const textNode of targets) {
    const text = textNode.nodeValue ?? '';
    const lc = text.toLowerCase();
    const frag = document.createDocumentFragment();
    let last = 0;
    let idx = lc.indexOf(lcQuery, 0);
    while (idx !== -1) {
      if (idx > last) frag.appendChild(document.createTextNode(text.slice(last, idx)));
      const mark = document.createElement('mark');
      mark.className = 'reader-hit';
      mark.textContent = text.slice(idx, idx + query.length);
      frag.appendChild(mark);
      marks.push(mark);
      last = idx + query.length;
      idx = lc.indexOf(lcQuery, last);
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    textNode.parentNode?.replaceChild(frag, textNode);
  }
  return marks;
}
