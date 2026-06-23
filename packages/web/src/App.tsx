import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildToc, parseFountain, type Character, type Note, type Template } from '@theatre/core';
import type { AnchorDraft } from '@theatre/annotations';
import * as api from './api';
import { Preview } from './components/Preview';
import { NotePopover, type PopoverTarget } from './components/NotePopover';
import { NotesPanel } from './components/NotesPanel';
import { CharactersPanel } from './components/CharactersPanel';
import { TemplatePanel } from './components/TemplatePanel';
import { CommandPalette, type Command } from './components/CommandPalette';
import type { NavTarget } from './components/Reader';

// Paged.js (~500 Ko) chargé à la demande, uniquement à l'ouverture du lecteur.
const Reader = lazy(() => import('./components/Reader').then((m) => ({ default: m.Reader })));

interface PlayState {
  slug: string;
  name: string;
  fountain: string;
  characters: Character[];
  template: Template;
}

export function App() {
  const [summaries, setSummaries] = useState<api.PlaySummary[]>([]);
  const [play, setPlay] = useState<PlayState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showEditor, setShowEditor] = useState(true);
  const [mode, setMode] = useState<'edit' | 'read'>('edit');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [navTarget, setNavTarget] = useState<NavTarget | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [orphans, setOrphans] = useState<Note[]>([]);
  const [popover, setPopover] = useState<{ target: PopoverTarget } | null>(null);
  const pendingDraft = useRef<Note | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.listPlays().then(setSummaries).catch(() => setMessage('Serveur injoignable.'));
  }, []);

  // Aperçu débattu : on évite de re-parser à chaque frappe.
  const [previewFountain, setPreviewFountain] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setPreviewFountain(play?.fountain ?? ''), 200);
    return () => clearTimeout(id);
  }, [play?.fountain]);

  const flash = (m: string) => {
    setMessage(m);
    setTimeout(() => setMessage((cur) => (cur === m ? null : cur)), 4000);
  };

  const onImport = async (file: File) => {
    setBusy('Import en cours…');
    try {
      const r = await api.importPdf(file);
      setPlay({
        slug: r.slug,
        name: r.meta.name,
        fountain: r.fountain,
        characters: r.meta.characters,
        template: r.meta.template,
      });
      setNotes([]);
      setSummaries(await api.listPlays());
      flash(
        `Importé : ${r.characterCount} personnages · normalisation ${r.usedLlm ? 'LLM' : 'heuristique'}.`,
      );
    } catch (e) {
      flash(`Échec de l'import : ${String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const onSelect = async (slug: string) => {
    if (!slug) return;
    setBusy('Chargement…');
    try {
      const { fountain, meta } = await api.loadPlay(slug);
      setPlay({ slug, name: meta.name, fountain, characters: meta.characters, template: meta.template });
      setNotes(await api.loadNotes(slug).catch(() => []));
    } catch (e) {
      flash(`Échec du chargement : ${String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const onSave = async () => {
    if (!play) return;
    setBusy('Sauvegarde…');
    try {
      await api.savePlay(play.slug, play.fountain, {
        name: play.name,
        characters: play.characters,
        template: play.template,
      });
      flash('Sauvegardé.');
    } catch (e) {
      flash(String(e));
    } finally {
      setBusy(null);
    }
  };

  const persistNotes = async (next: Note[]) => {
    setNotes(next);
    if (play) await api.saveNotes(play.slug, next).catch((e) => flash(String(e)));
  };

  const onActivateNote = useCallback(
    (id: string, rect: DOMRect) => {
      const note = notes.find((n) => n.id === id) ?? null;
      if (note) setPopover({ target: { note, rect } });
    },
    [notes],
  );

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
    pendingDraft.current = draftNote;
    setPopover({ target: { note: { ...draftNote }, rect } });
  }, []);

  const onPopoverSave = (body: string) => {
    const target = popover?.target;
    if (!target) return;
    const existing = target.note && notes.some((n) => n.id === target.note!.id);
    if (existing) {
      void persistNotes(
        notes.map((n) =>
          n.id === target.note!.id ? { ...n, body, updatedAt: new Date().toISOString() } : n,
        ),
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

  const onJumpNote = (note: Note) => {
    const el =
      document.querySelector<HTMLElement>(`[data-note-id="${note.id}"]`) ??
      document.querySelector<HTMLElement>(`[data-ni="${note.nodeIndex}"]`);
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } else if (mode === 'read') {
      navTo('entry', `h-${note.nodeIndex}`);
    }
  };

  const onExport = async () => {
    if (!play) return;
    setBusy('Export PDF…');
    try {
      const blob = await api.exportPdf(play.fountain, play.characters, play.template);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      flash(String(e));
    } finally {
      setBusy(null);
    }
  };

  const onExportReader = async () => {
    if (!play) return;
    setBusy('Export lecteur mobile…');
    try {
      const { blob, filename } = await api.exportReader(play.fountain, play.characters, play.template);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
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

  const setTemplate = (template: Template) => setPlay((p) => (p ? { ...p, template } : p));
  const setCharacters = (characters: Character[]) =>
    setPlay((p) => (p ? { ...p, characters } : p));

  // ---- Plein écran (toute l'app) ----
  useEffect(() => {
    const sync = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.();
  };

  // Navigation pilotée par la palette (ouvre le lecteur puis cible l'ancre/page).
  const navTo = (kind: NavTarget['kind'], value: string | number) => {
    setMode('read');
    setNavTarget((p) => ({ kind, value, nonce: (p?.nonce ?? 0) + 1 }));
  };

  // ---- Registre de commandes (palette ⌘K / Ctrl+K) ----
  const toc = useMemo(
    () => (play ? buildToc(parseFountain(play.fountain, play.characters), play.template) : []),
    [play],
  );
  const commands = useMemo<Command[]>(() => {
    const cmds: Command[] = [];
    cmds.push({ id: 'import', label: 'Importer un PDF', run: () => fileInput.current?.click() });
    if (play) {
      cmds.push({ id: 'save', label: 'Sauvegarder', hint: '', run: onSave });
      cmds.push({ id: 'export', label: 'Exporter en PDF', run: onExport });
      cmds.push({ id: 'export-reader', label: 'Exporter le lecteur mobile', run: onExportReader });
      cmds.push({
        id: 'reader',
        label: mode === 'read' ? 'Quitter le lecteur' : 'Ouvrir le lecteur',
        run: () => setMode(mode === 'read' ? 'edit' : 'read'),
      });
      cmds.push({
        id: 'editor',
        label: showEditor ? 'Masquer la source (Fountain)' : 'Afficher la source (Fountain)',
        run: () => setShowEditor((v) => !v),
      });
      cmds.push({
        id: 'fullscreen',
        label: isFullscreen ? 'Quitter le plein écran' : 'Plein écran',
        run: toggleFullscreen,
      });
      for (const e of toc) {
        cmds.push({
          id: `nav-${e.id}`,
          group: 'Aller à',
          label: e.label,
          run: () => navTo('entry', e.id),
        });
      }
    }
    return cmds;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [play, mode, showEditor, isFullscreen, toc]);

  // Raccourci global d'ouverture de la palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className={`app${isFullscreen ? ' fullscreen' : ''}`}>
      <header className="topbar">
        <div className="brand">Theatre&nbsp;Reader</div>
        <select
          className="play-select"
          value={play?.slug ?? ''}
          onChange={(e) => onSelect(e.target.value)}
        >
          <option value="">— ouvrir une pièce —</option>
          {summaries.map((s) => (
            <option key={s.slug} value={s.slug}>
              {s.name}
            </option>
          ))}
        </select>
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onImport(f);
            e.target.value = '';
          }}
        />
        <button onClick={() => fileInput.current?.click()}>Importer un PDF</button>
        <button className="ghost" title="Palette de commandes (⌘K / Ctrl+K)" onClick={() => setPaletteOpen(true)}>
          ⌘K
        </button>
        <div className="spacer" />
        {play && (
          <>
            <div className="seg" role="tablist" aria-label="Mode">
              <button
                className={`seg-btn${mode === 'edit' ? ' seg-on' : ''}`}
                aria-selected={mode === 'edit'}
                onClick={() => setMode('edit')}
              >
                Édition
              </button>
              <button
                className={`seg-btn${mode === 'read' ? ' seg-on' : ''}`}
                aria-selected={mode === 'read'}
                onClick={() => setMode('read')}
              >
                Lecture
              </button>
            </div>
            {mode === 'edit' && (
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={showEditor}
                  onChange={(e) => setShowEditor(e.target.checked)}
                />
                Source
              </label>
            )}
            <button onClick={onSave}>Sauvegarder</button>
            <button className="primary" onClick={onExport}>
              Exporter en PDF
            </button>
            <button onClick={onExportReader}>Lecteur mobile</button>
          </>
        )}
        {busy && <span className="busy">{busy}</span>}
        {message && <span className="message">{message}</span>}
      </header>

      {!play ? (
        <div className="empty">
          <div>
            <h1>Theatre Reader</h1>
            <p>Importe un texte de théâtre (PDF) pour le mettre en page et l'exporter.</p>
            <button className="primary" onClick={() => fileInput.current?.click()}>
              Importer un PDF
            </button>
          </div>
        </div>
      ) : mode === 'read' ? (
        <Suspense fallback={<div className="empty">Chargement du lecteur…</div>}>
          <Reader
            fountain={play.fountain}
            characters={play.characters}
            template={play.template}
            onClose={() => setMode('edit')}
            navTarget={navTarget}
            isFullscreen={isFullscreen}
            onToggleFullscreen={toggleFullscreen}
            notes={notes}
            onActivate={onActivateNote}
            onRequestCreate={onRequestCreate}
            onOrphans={setOrphans}
          />
        </Suspense>
      ) : (
        <main className="workspace">
          <aside className="sidebar">
            <CharactersPanel
              characters={play.characters}
              template={play.template}
              onChange={setTemplate}
              onCharactersChange={setCharacters}
            />
            <TemplatePanel template={play.template} onChange={setTemplate} />
            <NotesPanel notes={notes} orphans={orphans} onJump={onJumpNote} />
          </aside>

          {showEditor && (
            <section className="editor-pane">
              <div className="pane-title">Source (Fountain)</div>
              <textarea
                className="editor"
                value={play.fountain}
                spellCheck={false}
                onChange={(e) => setPlay((p) => (p ? { ...p, fountain: e.target.value } : p))}
              />
            </section>
          )}

          <section className="preview-pane">
            <div className="pane-title">Aperçu</div>
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
          </section>
        </main>
      )}

      {popover && play && (
        <NotePopover
          target={popover.target}
          editable={true}
          onSave={onPopoverSave}
          onDelete={onPopoverDelete}
          onClose={() => setPopover(null)}
        />
      )}

      <CommandPalette
        open={paletteOpen}
        commands={commands}
        onClose={() => setPaletteOpen(false)}
      />
    </div>
  );
}
