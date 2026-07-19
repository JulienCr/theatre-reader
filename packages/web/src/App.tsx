import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildToc,
  parseFountain,
  speechTextForTts,
  type AudioConfig,
  type Character,
  type Note,
  type Template,
} from '@theatre/core';
import type { AnchorDraft } from '@theatre/annotations';
import * as api from './api';
import { Preview } from './components/Preview';
import { NotePopover, type PopoverTarget } from './components/NotePopover';
import { NotesPanel } from './components/NotesPanel';
import { CharactersPanel } from './components/CharactersPanel';
import { VoicesPanel } from './components/VoicesPanel';
import { TemplatePanel } from './components/TemplatePanel';
import { CommandPalette, type Command } from './components/CommandPalette';
import { AudioProgressModal, type AudioGenState } from './components/AudioProgressModal';
import type { NavTarget } from './components/Reader';

// Paged.js (~500 Ko) chargé à la demande, uniquement à l'ouverture du lecteur.
const Reader = lazy(() => import('./components/Reader').then((m) => ({ default: m.Reader })));

interface PlayState {
  slug: string;
  name: string;
  fountain: string;
  characters: Character[];
  template: Template;
  audio: AudioConfig;
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
  const [voices, setVoices] = useState<api.VoiceSummary[] | null>(null);
  const [exportWithAudio, setExportWithAudio] = useState(false);
  const [audioGen, setAudioGen] = useState<(AudioGenState & { controller: AbortController }) | null>(
    null,
  );
  const [popover, setPopover] = useState<{ target: PopoverTarget } | null>(null);
  const pendingDraft = useRef<Note | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.listPlays().then(setSummaries).catch(() => setMessage('Serveur injoignable.'));
    // Voix ElevenLabs (null = synthèse désactivée, pas de clé).
    api.listVoices().then(setVoices).catch(() => setVoices(null));
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
        audio: r.meta.audio ?? {},
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
      setPlay({
        slug,
        name: meta.name,
        fountain,
        characters: meta.characters,
        template: meta.template,
        audio: meta.audio ?? {},
      });
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
        audio: play.audio,
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
      nodeId: anchor.nodeId,
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
      document.querySelector<HTMLElement>(`[data-nid="${note.nodeId}"]`);
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
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
    setBusy(exportWithAudio ? 'Export lecteur mobile (audio)…' : 'Export lecteur mobile…');
    try {
      // Toutes les voix (roles: 'all' par défaut côté serveur) : le fichier est complet.
      // La mise en pause de mon rôle en répétition est gérée par le lecteur (bouton « Répét. »).
      const audioOpts =
        exportWithAudio && play.audio.voices && Object.keys(play.audio.voices).length
          ? { slug: play.slug, audio: play.audio, includeAudio: true }
          : undefined;
      const { blob, filename } = await api.exportReader(
        play.fountain,
        play.characters,
        play.template,
        notes,
        audioOpts,
      );
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
  const setAudio = (audio: AudioConfig) => setPlay((p) => (p ? { ...p, audio } : p));

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
  // AST partagé : parseFountain est coûteux (split + re-parse complet). On le mémoïse une seule
  // fois et on le réutilise pour la TOC, l'estimation et le batch audio plutôt que de re-parser
  // dans chaque calcul.
  const parsed = useMemo(
    () => (play ? parseFountain(play.fountain, play.characters) : null),
    [play?.fountain, play?.characters],
  );

  const toc = useMemo(
    () => (parsed && play ? buildToc(parsed, play.template) : []),
    [parsed, play?.template],
  );

  // Estimation du coût audio de l'export (caractères ElevenLabs pour toutes les voix,
  // mon rôle inclus : l'export embarque tout, la répétition est gérée à la lecture).
  const audioEstimate = useMemo(() => {
    const cfg = play?.audio;
    if (!parsed || !cfg?.voices || !Object.keys(cfg.voices).length) return null;
    let chars = 0;
    let lines = 0;
    for (const n of parsed.nodes) {
      if (n.type !== 'line') continue;
      if (!cfg.voices[n.characterId]) continue;
      const t = speechTextForTts(n);
      if (!t) continue;
      chars += t.length;
      lines += 1;
    }
    return { chars, lines };
  }, [parsed, play?.audio]);

  // Toutes les tirades à pré-générer : tout personnage ayant une voix (y compris le mien).
  // `text` via `speechTextForTts` (normalisation canonique, = audio-player collectTirades) pour
  // taper la même clé de cache disque ; sinon on régénère dans le vide. `nodeId` synthétique (index) :
  // il ne sert qu'à compter cached/generated dans le manifeste renvoyé.
  // Dédup par identité de cache (voix + texte) : deux tirades identiques partagent la même clé
  // disque. Sans dédup, deux occurrences dans un même lot (workers concurrents, cache-first)
  // manquent toutes deux le cache et déclenchent deux appels ElevenLabs pour la même clé.
  const audioBatchItems = useMemo<api.TtsBatchItem[]>(() => {
    const cfg = play?.audio;
    if (!parsed || !cfg?.voices || !Object.keys(cfg.voices).length) return [];
    const items: api.TtsBatchItem[] = [];
    const seen = new Set<string>();
    parsed.nodes.forEach((n, i) => {
      if (n.type !== 'line') return;
      const voiceId = cfg.voices?.[n.characterId];
      if (!voiceId) return;
      const text = speechTextForTts(n);
      if (!text) return;
      const identity = `${voiceId}\n${text}`;
      if (seen.has(identity)) return;
      seen.add(identity);
      items.push({ nodeId: String(i), text, voiceId });
    });
    return items;
  }, [parsed, play?.audio]);

  // Pré-génère l'audio de toutes les tirades, par lots, en réutilisant le cache disque.
  const onGenerateAllAudio = useCallback(async () => {
    if (!play) return;
    const items = audioBatchItems;
    if (!items.length) {
      setMessage('Aucune voix assignée : rien à générer.');
      return;
    }
    const controller = new AbortController();
    setAudioGen({
      total: items.length,
      done: 0,
      generated: 0,
      cached: 0,
      error: null,
      running: true,
      controller,
    });
    let done = 0;
    let generated = 0;
    let cached = 0;
    const CHUNK = 10;
    try {
      for (let i = 0; i < items.length; i += CHUNK) {
        if (controller.signal.aborted) break;
        const chunk = items.slice(i, i + CHUNK);
        const { manifest } = await api.ttsBatch(play.slug, chunk, {
          model: play.audio.model,
          settings: play.audio.settings,
          signal: controller.signal,
        });
        for (const v of Object.values(manifest)) v.cached ? (cached += 1) : (generated += 1);
        done += chunk.length;
        setAudioGen((s) => (s ? { ...s, done, generated, cached } : s));
      }
      setAudioGen((s) => (s ? { ...s, running: false } : s));
    } catch (e) {
      if (controller.signal.aborted) {
        setAudioGen((s) => (s ? { ...s, running: false } : s));
      } else {
        setAudioGen((s) =>
          s ? { ...s, running: false, error: e instanceof Error ? e.message : String(e) } : s,
        );
      }
    }
  }, [play, audioBatchItems]);

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
  }, [play, mode, showEditor, isFullscreen, toc, notes, exportWithAudio]);

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
            {audioBatchItems.length > 0 && (
              <button
                onClick={onGenerateAllAudio}
                disabled={Boolean(audioGen?.running)}
                title={`Pré-générer l'audio de ${audioBatchItems.length} tirades (réutilise le cache ; prépare aussi l'export mobile)`}
              >
                🎙️ Générer l'audio
              </button>
            )}
            {audioEstimate && (
              <label
                className="toggle"
                title={`Embarquer toutes les voix dans l'export mobile (mon rôle inclus ; la répétition met mon rôle en pause côté lecteur) — réutilisé du cache disque (gratuit si déjà généré via 🎙️). Synthèse à la volée uniquement pour les répliques manquantes : ~${audioEstimate.chars} caractères ElevenLabs, ${audioEstimate.lines} répliques au maximum.`}
              >
                <input
                  type="checkbox"
                  checked={exportWithAudio}
                  onChange={(e) => setExportWithAudio(e.target.checked)}
                />
                🔊 audio
              </label>
            )}
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
            slug={play.slug}
            fountain={play.fountain}
            characters={play.characters}
            template={play.template}
            audio={play.audio}
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
            <VoicesPanel
              characters={play.characters}
              audio={play.audio}
              voices={voices}
              slug={play.slug}
              onChange={setAudio}
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
        open={paletteOpen && !audioGen}
        commands={commands}
        onClose={() => setPaletteOpen(false)}
      />

      {audioGen && (
        <AudioProgressModal
          {...audioGen}
          onCancel={() => audioGen.controller.abort()}
          onClose={() => setAudioGen(null)}
        />
      )}
    </div>
  );
}
