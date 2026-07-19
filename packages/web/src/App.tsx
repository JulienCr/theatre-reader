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
import { CastPanel } from './components/CastPanel';
import { TemplatePanel } from './components/TemplatePanel';
import { CommandPalette, type Command } from './components/CommandPalette';
import { AudioProgressModal, type AudioGenState } from './components/AudioProgressModal';
import { TopBar, type SaveState } from './components/TopBar';
import { ShortcutList } from './components/ShortcutList';
import { Workspace, type DockPanel } from './components/Workspace';
import { Modal } from './components/ui/Modal';
import { Toasts, type FlashMessage } from './components/ui/Toasts';
import { applyTheme, loadTheme, type ThemePref } from './theme';
import { loadSessionPrefs, saveSessionPrefs } from './sessionPrefs';
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

/** Inactivité après la dernière modification avant sauvegarde automatique. */
const AUTOSAVE_DELAY = 2000;

/**
 * Empreinte de tout ce que `savePlay` écrit sur disque. Comparée à celle du
 * dernier enregistrement, elle dit si l'état est *réellement* sale : un simple
 * changement de référence d'objet ne suffit pas, React en produit à foison.
 */
const playSignature = (p: PlayState): string =>
  JSON.stringify([p.fountain, p.name, p.characters, p.template, p.audio]);

export function App() {
  const [summaries, setSummaries] = useState<api.PlaySummary[]>([]);
  const [play, setPlay] = useState<PlayState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<FlashMessage | null>(null);
  const [showEditor, setShowEditor] = useState(true);
  const [mode, setMode] = useState<'edit' | 'read'>('edit');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [theme, setTheme] = useState<ThemePref>(loadTheme);
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
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [playsLoaded, setPlaysLoaded] = useState(false);
  const pendingDraft = useRef<Note | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const flashId = useRef(0);
  // Empreinte du dernier état réellement écrit sur disque, avec sa pièce. C'est
  // LA garde contre l'autosauvegarde parasite : au premier rendu d'une pièce on
  // adopte son contenu fraîchement lu comme référence, si bien que le `setPlay`
  // du chargement (ou de la restauration de session) ne ressemble plus à une
  // frappe et ne déclenche aucune écriture.
  const savedRef = useRef<{ slug: string; sig: string } | null>(null);
  // Écritures sérialisées : deux sauvegardes en vol pourraient se doubler et la
  // plus ancienne écraser la plus récente.
  const saveChain = useRef<Promise<void>>(Promise.resolve());
  // Miroir de `play` pour les callbacks stables (⌘S, fin d'écriture) : sans lui
  // il faudrait ré-abonner l'écouteur clavier à chaque frappe.
  const playRef = useRef<PlayState | null>(null);
  const restored = useRef(false);

  // `flash` garde sa signature (m: string) => void ; seule la destination change :
  // un toast portalisé au lieu d'un <span> dans la barre. Stable (deps vides) pour
  // ne pas périmer les callbacks mémoïsées qui l'appellent.
  const flash = useCallback((m: string) => {
    flashId.current += 1;
    // Un id à chaque appel : deux messages identiques à la suite doivent
    // réapparaître, alors qu'une même chaîne ne déclencherait aucun rendu.
    setMessage({ id: flashId.current, text: m });
  }, []);

  useEffect(() => {
    api.listPlays()
      .then((list) => {
        setSummaries(list);
        // Marqueur explicite : la restauration de session doit savoir que la
        // liste est connue *même si elle est vide*, sinon un import ultérieur
        // (qui remplit la liste) déclencherait une restauration tardive et
        // basculerait sur une autre pièce sous les yeux de l'utilisateur.
        setPlaysLoaded(true);
      })
      .catch(() => flash('Serveur injoignable.'));
    // Voix ElevenLabs (null = synthèse désactivée, pas de clé).
    api.listVoices().then(setVoices).catch(() => setVoices(null));
  }, [flash]);

  useEffect(() => applyTheme(theme), [theme]);

  // Aperçu débattu : on évite de re-parser à chaque frappe.
  const [previewFountain, setPreviewFountain] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setPreviewFountain(play?.fountain ?? ''), 200);
    return () => clearTimeout(id);
  }, [play?.fountain]);

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

  // Mémoïsée : la restauration de session l'appelle depuis un effet, et une
  // identité stable évite de relancer cet effet à chaque rendu.
  const onSelect = useCallback(
    async (slug: string) => {
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
    },
    [flash],
  );

  // ---- Sauvegarde : automatique (débouncée), manuelle (⌘S), et témoin d'état ----

  /** Écrit la pièce sur disque. Toujours passer par ici : c'est le point de sérialisation. */
  const persistPlay = useCallback(
    (p: PlayState, opts?: { manual?: boolean }) => {
      const sig = playSignature(p);
      const run = saveChain.current.then(async () => {
        setSaveState('saving');
        try {
          await api.savePlay(p.slug, p.fountain, {
            name: p.name,
            characters: p.characters,
            template: p.template,
            audio: p.audio,
          });
          savedRef.current = { slug: p.slug, sig };
          // L'utilisateur a pu retaper pendant l'écriture : le témoin doit alors
          // rester « modifié » — la prochaine écriture est déjà armée par le débounce.
          const latest = playRef.current;
          const stillDirty = Boolean(
            latest && latest.slug === p.slug && playSignature(latest) !== sig,
          );
          setSaveState(stillDirty ? 'dirty' : 'saved');
          // Pas de toast à chaque sauvegarde automatique : ce serait un clignotant
          // permanent. Le témoin suffit ; seule la sauvegarde manuelle est bavarde.
          if (opts?.manual) flash('Sauvegardé.');
        } catch (e) {
          setSaveState('error');
          flash(String(e));
        }
      });
      // La chaîne ne doit jamais rester rejetée, sinon toute écriture ultérieure
      // serait court-circuitée.
      saveChain.current = run.catch(() => undefined);
      return run;
    },
    [flash],
  );

  const onSave = useCallback(async () => {
    const p = playRef.current;
    if (!p) return;
    await persistPlay(p, { manual: true });
  }, [persistPlay]);

  useEffect(() => {
    playRef.current = play;
  }, [play]);

  // Sauvegarde automatique, débouncée, et uniquement si l'état diffère du disque.
  useEffect(() => {
    if (!play) return;
    const sig = playSignature(play);
    if (savedRef.current?.slug !== play.slug) {
      // Pièce fraîchement chargée ou importée : son contenu EST celui du disque.
      savedRef.current = { slug: play.slug, sig };
      setSaveState('idle');
      return;
    }
    if (sig === savedRef.current.sig) {
      // Retour à l'état enregistré (frappe annulée) : plus rien à écrire.
      setSaveState((s) => (s === 'dirty' ? 'idle' : s));
      return;
    }
    setSaveState((s) => (s === 'saving' ? s : 'dirty'));
    const id = setTimeout(() => void persistPlay(play), AUTOSAVE_DELAY);
    return () => clearTimeout(id);
  }, [play, persistPlay]);

  // ⌘S / Ctrl+S : sauvegarde immédiate. `preventDefault` impératif, sinon c'est
  // la boîte « Enregistrer la page » du navigateur qui s'ouvre.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void onSave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onSave]);

  // Filet de dernier recours : prévenir avant de fermer un onglet dont les
  // modifications ne sont pas encore parties. L'écouteur n'est posé que quand il
  // y a quelque chose à perdre — présent en permanence, il gênerait chaque
  // rechargement pour rien.
  useEffect(() => {
    if (saveState !== 'dirty' && saveState !== 'saving') return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [saveState]);

  // ---- Session : pièce ouverte + mode, restaurés au chargement ----
  useEffect(() => {
    if (restored.current || !playsLoaded) return;
    restored.current = true;
    const s = loadSessionPrefs();
    // Slug inconnu (pièce supprimée depuis) : on l'ignore, sans bruit.
    if (s.slug && summaries.some((x) => x.slug === s.slug)) {
      setMode(s.mode);
      void onSelect(s.slug);
    }
  }, [playsLoaded, summaries, onSelect]);

  useEffect(() => {
    // Avant la restauration, `play` est null et `mode` vaut sa valeur initiale :
    // écrire ici effacerait la session qu'on s'apprête justement à lire.
    if (!restored.current) return;
    saveSessionPrefs({ slug: play?.slug ?? null, mode });
  }, [play?.slug, mode]);

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
      flash('Aucune voix assignée : rien à générer.');
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
  }, [play, audioBatchItems, flash]);

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

  // Les panneaux du dock. `Distribution` est désormais une liste unique
  // (`CastPanel`) : surlignage et voix tiennent sur la ligne du personnage, au
  // lieu des deux listes parallèles qui redoublaient chaque nom.
  const dockPanels = useMemo<DockPanel[]>(() => {
    if (!play) return [];
    return [
      {
        id: 'cast',
        label: 'Distribution',
        icon: 'users',
        content: (
          <CastPanel
            characters={play.characters}
            template={play.template}
            audio={play.audio}
            voices={voices}
            slug={play.slug}
            onTemplateChange={setTemplate}
            onCharactersChange={setCharacters}
            onAudioChange={setAudio}
          />
        ),
      },
      {
        id: 'layout',
        label: 'Mise en page',
        icon: 'sliders',
        content: <TemplatePanel template={play.template} onChange={setTemplate} />,
      },
      {
        id: 'notes',
        label: 'Notes',
        icon: 'sticky-note',
        content: <NotesPanel notes={notes} orphans={orphans} onJump={onJumpNote} />,
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [play, voices, notes, orphans]);

  return (
    <div className={`app${isFullscreen ? ' fullscreen' : ''}`}>
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

      <TopBar
        summaries={summaries}
        playSlug={play?.slug ?? null}
        playName={play?.name ?? null}
        mode={mode}
        onMode={setMode}
        onSelectPlay={onSelect}
        onImport={() => fileInput.current?.click()}
        onSave={onSave}
        saveState={saveState}
        onExportPdf={onExport}
        onExportReader={onExportReader}
        exportWithAudio={exportWithAudio}
        onExportWithAudio={setExportWithAudio}
        audioEstimate={audioEstimate}
        audioBatchCount={audioBatchItems.length}
        audioRunning={Boolean(audioGen?.running)}
        onGenerateAudio={onGenerateAllAudio}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
        onOpenPalette={() => setPaletteOpen(true)}
        onOpenShortcuts={() => setShortcutsOpen(true)}
        theme={theme}
        onTheme={setTheme}
      />

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
        <Workspace
          panels={dockPanels}
          template={play.template}
          onTemplateChange={setTemplate}
          isFullscreen={isFullscreen}
          sourceOpen={showEditor}
          onSourceOpen={setShowEditor}
          preview={
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
          }
          source={
            <textarea
              className="editor"
              value={play.fountain}
              spellCheck={false}
              onChange={(e) => setPlay((p) => (p ? { ...p, fountain: e.target.value } : p))}
            />
          }
        />
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

      <Modal open={shortcutsOpen} onOpenChange={setShortcutsOpen} title="Raccourcis clavier">
        <ShortcutList />
      </Modal>

      <Toasts busy={busy} message={message} onDismissMessage={() => setMessage(null)} />
    </div>
  );
}
