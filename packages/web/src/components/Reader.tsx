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
  type AudioConfig,
  type Character,
  type Note,
  type Template,
} from '@theatre/core';
import { annotationCss, type AnchorDraft } from '@theatre/annotations';
import {
  createPlayer,
  type AudioTirade,
  type Player,
  type PlayerState,
  type ReadingSettings,
} from '@theatre/audio-player';
import { useAnnotations } from '../useAnnotations';
import { loadReadingPrefs, saveReadingPrefs, type ReadingPrefs } from '../readingPrefs';
import { ReadingModeModal } from './ReadingModeModal';
import * as api from '../api';

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
  slug,
  fountain,
  characters,
  template,
  audio,
  onClose,
  navTarget,
  isFullscreen,
  onToggleFullscreen,
  notes,
  onActivate,
  onRequestCreate,
  onOrphans,
}: {
  slug: string;
  fountain: string;
  characters: Character[];
  template: Template;
  audio: AudioConfig;
  onClose: () => void;
  navTarget: NavTarget | null;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  notes: Note[];
  onActivate: (id: string, rect: DOMRect) => void;
  onRequestCreate: (anchor: AnchorDraft, rect: DOMRect) => void;
  onOrphans?: (orphans: Note[]) => void;
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
  const [pstate, setPstate] = useState<PlayerState | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const fallbackRoles = useMemo(() => (audio.myCharacterId ? [audio.myCharacterId] : []), [audio.myCharacterId]);
  // Chargé une seule fois (évite deux lectures localStorage + JSON.parse au montage).
  const initialPrefs = useRef<ReadingPrefs | null>(null);
  if (initialPrefs.current === null) initialPrefs.current = loadReadingPrefs(slug, fallbackRoles);
  const [settings, setSettings] = useState<ReadingSettings>(initialPrefs.current.settings);
  const [myRoles, setMyRoles] = useState<string[]>(initialPrefs.current.myRoles);
  const [showModeModal, setShowModeModal] = useState(false);

  const play = useMemo(() => parseFountain(fountain, characters), [fountain, characters]);
  const toc = useMemo(() => buildToc(play, template), [play, template]);

  // ---- Lecture audio (ElevenLabs) ----
  const playerRef = useRef<Player | null>(null);
  const pstateRef = useRef<PlayerState | null>(null);
  const urlCacheRef = useRef<Map<string, string>>(new Map());
  // Refs pour que resolveAudio/isMine lisent toujours l'état courant sans se recréer.
  const audioCfgRef = useRef<AudioConfig>(audio);
  const slugRef = useRef<string>(slug);
  const settingsRef = useRef<ReadingSettings>(settings);
  const myRolesRef = useRef<string[]>(myRoles);
  audioCfgRef.current = audio;
  slugRef.current = slug;
  pstateRef.current = pstate;
  settingsRef.current = settings;
  myRolesRef.current = myRoles;

  // Recharge les préférences par appareil quand on change de pièce.
  useEffect(() => {
    const roles = audioCfgRef.current.myCharacterId ? [audioCfgRef.current.myCharacterId] : [];
    const p = loadReadingPrefs(slug, roles);
    setSettings(p.settings);
    setMyRoles(p.myRoles);
  }, [slug]);

  // Change un réglage de répétition : état + ref + moteur + persistance.
  const changeSettings = useCallback(
    (patch: Partial<ReadingSettings>) => {
      const next = { ...settingsRef.current, ...patch };
      settingsRef.current = next;
      setSettings(next);
      playerRef.current?.setSettings(patch);
      saveReadingPrefs(slug, { settings: next, myRoles: myRolesRef.current });
    },
    [slug],
  );

  // Change mes rôles : état + ref + moteur + persistance.
  const changeRoles = useCallback(
    (cids: string[]) => {
      myRolesRef.current = cids;
      setMyRoles(cids);
      playerRef.current?.setRoles(cids);
      saveReadingPrefs(slug, { settings: settingsRef.current, myRoles: cids });
    },
    [slug],
  );

  const nameOf = useCallback(
    (cid: string | null) => (cid ? play.characters.find((c) => c.id === cid)?.canonicalName ?? cid : ''),
    [play],
  );

  const hasVoices = Boolean(audio.voices && Object.keys(audio.voices).length > 0);

  // Récupère (et mémoïse) l'audio d'une tirade ; null si le perso n'a pas de voix.
  const resolveAudio = useCallback(async (t: AudioTirade): Promise<string | null> => {
    const cfg = audioCfgRef.current;
    const voiceId = cfg.voices?.[t.characterId];
    if (!voiceId) return null;
    const cacheKey = `${t.nodeId}|${voiceId}`;
    const cached = urlCacheRef.current.get(cacheKey);
    if (cached) return cached;
    const blob = await api.tts(slugRef.current, {
      text: t.text,
      voiceId,
      model: cfg.model,
      settings: cfg.settings,
    });
    const url = URL.createObjectURL(blob);
    urlCacheRef.current.set(cacheKey, url);
    return url;
  }, []);

  // Libère les object URLs à la fermeture du lecteur.
  useEffect(() => {
    const cache = urlCacheRef.current;
    return () => {
      cache.forEach((u) => URL.revokeObjectURL(u));
      cache.clear();
    };
  }, []);

  // Efface l'erreur audio après quelques secondes.
  useEffect(() => {
    if (!audioError) return;
    const id = setTimeout(() => setAudioError(null), 5000);
    return () => clearTimeout(id);
  }, [audioError]);

  // CSS de surlignage des notes (injecté une fois).
  useEffect(() => {
    const id = 'annotation-css';
    if (!document.getElementById(id)) {
      const style = document.createElement('style');
      style.id = id;
      style.textContent = annotationCss;
      document.head.appendChild(style);
    }
  }, []);

  // Décoration des notes sur le DOM paginé : relancée à chaque fin de pagination
  // (status → ready) ou re-pagination (totalPages varie).
  useAnnotations(containerRef, notes, {
    editable: true,
    redecorateKey: `${status}:${totalPages}`,
    onActivate,
    onRequestCreate,
    onOrphans,
  });

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

  // Instancie le moteur audio sur le DOM paginé (recréé après chaque pagination).
  // Seulement si des voix sont attribuées, sinon transport/clavier restent inertes.
  useEffect(() => {
    if (status !== 'ready' || !hasVoices) return;
    const container = containerRef.current;
    if (!container) return;
    const player = createPlayer({
      container,
      resolveAudio,
      roles: myRolesRef.current,
      settings: settingsRef.current,
      onState: setPstate,
      onError: setAudioError,
      speakingClass: 'line--speaking',
    });
    playerRef.current = player;
    return () => {
      player.destroy();
      playerRef.current = null;
      setPstate(null);
    };
  }, [status, totalPages, resolveAudio, hasVoices]);

  // Clic sur une réplique → l'écouter (sans gêner sélection de notes / ancres).
  useEffect(() => {
    if (status !== 'ready') return;
    const container = containerRef.current;
    if (!container) return;
    const onClick = (e: MouseEvent) => {
      const player = playerRef.current;
      if (!player) return;
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) return; // sélection en cours → notes
      const target = e.target;
      if (!(target instanceof Element)) return; // ex. clic sur un nœud texte
      if (target.closest('.note-anchor')) return; // activation d'une note
      const line = target.closest('p.line') as HTMLElement | null;
      const nid = line?.getAttribute('data-nid');
      if (!nid) return;
      // Réplique masquée : un clic la révèle (peek), sans la jouer.
      if (line?.classList.contains('line--masked')) {
        player.reveal(nid);
        return;
      }
      player.playFrom(nid);
    };
    container.addEventListener('click', onClick);
    return () => container.removeEventListener('click', onClick);
  }, [status]);

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
        if (showModeModal) setShowModeModal(false);
        else if (showHelp) setShowHelp(false);
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
        case ' ': {
          const player = playerRef.current;
          if (!player) break;
          e.preventDefault();
          if (pstateRef.current?.waitingForUser) player.resume();
          else player.toggle();
          break;
        }
        case '.':
          playerRef.current?.next();
          break;
        case ',':
          playerRef.current?.prev();
          break;
        case 'm':
          if (hasVoices) setShowModeModal((v) => !v);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showHelp, showModeModal, hasVoices, step, onClose, onToggleFullscreen]);

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

        {hasVoices && (
          <div className="reader-audio">
            <button
              aria-label={pstate?.playing && !pstate?.waitingForUser ? 'Pause' : 'Lecture'}
              title={pstate?.playing && !pstate?.waitingForUser ? 'Pause (Espace)' : 'Lecture (Espace)'}
              onClick={() => {
                const p = playerRef.current;
                if (!p) return;
                if (pstate?.waitingForUser) p.resume();
                else p.toggle();
              }}
            >
              {pstate?.playing && !pstate?.waitingForUser ? '⏸' : '▶'}
            </button>
            <button
              aria-label="Réplique précédente"
              title="Réplique précédente ( , )"
              onClick={() => playerRef.current?.prev()}
            >
              ⏮
            </button>
            <button
              aria-label="Réplique suivante"
              title="Réplique suivante ( . )"
              onClick={() => playerRef.current?.next()}
            >
              ⏭
            </button>
            <button
              className={`reader-mode-btn${settings.rehearsal ? ' on' : ''}`}
              aria-haspopup="dialog"
              title="Mode de lecture (m)"
              onClick={() => setShowModeModal(true)}
            >
              {settings.rehearsal ? 'Répétition' : 'Continu'}
            </button>
            <span className="reader-speaker">
              {pstate?.waitingForUser
                ? pstate.timed
                  ? `À toi (${Math.ceil((pstate.timedMs ?? 0) / 1000)} s) — ${nameOf(pstate.currentCharacterId)}`
                  : `À toi — ${nameOf(pstate.currentCharacterId)}`
                : nameOf(pstate?.currentCharacterId ?? null)}
            </span>
            {audioError && <span className="reader-audio-error">{audioError}</span>}
          </div>
        )}

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
        {showModeModal && hasVoices && (
          <ReadingModeModal
            settings={settings}
            myRoles={myRoles}
            characters={play.characters}
            onSettings={changeSettings}
            onRoles={changeRoles}
            onClose={() => setShowModeModal(false)}
          />
        )}
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
    ['Espace', 'Lecture / pause · reprend (dit ta réplique)'],
    ['.  ·  ,', 'Réplique audio suivante · précédente'],
    ['m', 'Mode de lecture (continu / répétition…)'],
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
