/**
 * Chrome du lecteur mobile : bandeau de contexte, barre du bas, sheets.
 *
 * INVARIANT ABSOLU — React ne possède JAMAIS le texte de la pièce.
 * Le contenu de `.play` vient de `renderBody()` (@theatre/core) sous forme de
 * HTML brut, et trois systèmes le mutent impérativement :
 *   - `decorate()` de @theatre/annotations (notes figées),
 *   - `createPlayer()` de @theatre/audio-player (`line--speaking`, `line--masked`,
 *     `line--revealed`, barre de temps),
 *   - `createSearch()` de @theatre/reader-ui (injection de `<mark>`).
 * Ce composant est monté dans un conteneur séparé (`#reader-chrome`) et ne touche
 * `.play` que par des effets impératifs explicites (taille du texte, surlignage
 * des personnages, observation des ancres de scène) : s'il rendait `.play`, il
 * écraserait les mutations ci-dessus.
 * Même patron que `packages/web/src/components/Reader.tsx`.
 *
 * ── Agencement de la barre ────────────────────────────────────────────────────
 * Trois zones : le menu à gauche, l'action centrale au milieu, une bascule à
 * droite. Les zones latérales sont élastiques et de même souplesse, ce qui
 * centre la zone du milieu sans la mesurer. Aucun bouton ne rétrécit : une
 * barre trop étroite doit se voir à la conception, jamais tronquer un libellé.
 *
 * Le nombre d'actions dépend de l'export : avec des clips audio la barre est un
 * transport (⏮ ▶ ⏭ + Répétition), sans clips le transport n'a aucun sens et la
 * place revient aux trois navigations les plus utilisées. Le reste vit dans la
 * sheet « Options », derrière le menu — c'est ce qui garde la barre courte quelle
 * que soit la largeur de l'écran.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { decorate } from '@theatre/annotations';
import {
  createPlayer,
  type Player,
  type PlayerState,
  type ReadingSettings,
  type SpeechRecognizer,
  type Tolerance,
} from '@theatre/audio-player';
import { sceneVisibility } from '@theatre/core';
import { ContextBanner, TransportDock, type SearchController } from '@theatre/reader-ui';
import { Button, Icon, IconButton, Sheet, Toolbar, ToolbarGroup } from '@theatre/ui';
import {
  colorFor,
  FONT_MAX,
  FONT_MIN,
  loadRate,
  loadVoice,
  RATES,
  saveRate,
  saveState,
  saveVoice,
  type PersistedState,
} from './state';
import { applySceneVisibility, rangeIndex } from './visibility';
import { VoiceFeedback } from './VoiceFeedback';
import type { ReaderData } from './types';

type SheetName = 'options' | 'chars' | 'scenes' | 'search' | 'mode' | 'note' | null;

const clampFont = (p: number): number => Math.min(FONT_MAX, Math.max(FONT_MIN, p));

/** Options de répétition, dans l'ordre d'affichage. */
const REHEARSAL_OPTIONS: { key: keyof ReadingSettings; label: string; hint: string }[] = [
  { key: 'mask', label: 'Masquer mes répliques', hint: "Floutées jusqu'à ce qu'elles soient dites." },
  { key: 'playMine', label: 'Me faire répéter', hint: 'À la reprise, le TTS lit ma réplique.' },
  { key: 'autoAdvance', label: 'Avancement automatique', hint: 'Reprise auto après la durée, sans clic.' },
  { key: 'tick', label: "Bip quand c'est à moi", hint: '' },
];

/**
 * Boîte d'observation des en-têtes : tout ce qui est au-dessus de la ligne des
 * 12 % de hauteur d'écran. Un en-tête « intersecte » donc exactement quand il a
 * été franchi, et le bandeau affiche le dernier de la liste dans ce cas.
 *
 * Les deux valeurs sont contre-intuitives et toutes deux nécessaires :
 * - la marge haute doit couvrir la pièce entière (elle fait ici ~40 000 px) :
 *   un en-tête sorti de la boîte serait considéré comme non franchi ;
 * - la marge basse est en pourcentage pour suivre les rotations d'écran sans
 *   avoir à reconstruire l'observateur.
 *
 * Une bande fine à hauteur de la ligne (la formulation évidente) ne marche PAS :
 * l'observateur échantillonne par image, et un saut instantané — c'est le cas de
 * « aller à une scène » — passe de « sous l'écran » à « au-dessus de la ligne »
 * sans état intermédiaire, donc sans notification. Mesuré : le bandeau restait
 * vide après chaque saut.
 */
const SCENE_ROOT_MARGIN = '1000000px 0px -88% 0px';

export function Chrome({
  data,
  play,
  search,
  initial,
  onExit,
  recognizer,
}: {
  data: ReaderData;
  /** Le `.play` rendu par @theatre/core — jamais rendu par React, seulement muté. */
  play: HTMLElement;
  search: SearchController;
  initial: PersistedState;
  /** Fourni par l'app seule : le .html exporté n'a nulle part où sortir. */
  onExit?: () => void;
  /** Fourni par l'app seule : sans lui, aucun réglage vocal n'est proposé. */
  recognizer?: SpeechRecognizer;
}) {
  const [selected, setSelected] = useState<string[]>(initial.selected);
  // Borné dès la lecture : un localStorage abîmé ne doit pas rendre la pièce illisible.
  const [fontPct, setFontPct] = useState(clampFont(initial.fontPct));
  const [reading, setReading] = useState<ReadingSettings>(initial.reading);
  // Vitesse : globale à toutes les pièces, d'où sa propre clé (cf. state.ts).
  const [rate, setRate] = useState(loadRate);
  // Boucle : volontairement NON persistée. Rouvrir l'app enfermé dans une scène
  // sans se rappeler l'avoir demandé est pire que de ré-appuyer sur le bouton.
  const [loop, setLoop] = useState(false);
  const [sheet, setSheet] = useState<SheetName>(null);
  // Sheet d'où vient la sheet courante, pour offrir le retour. Volontairement
  // NON remise à zéro à la fermeture : sinon le bouton « Retour » disparaîtrait
  // net pendant que le panneau glisse encore vers le bas.
  const [parent, setParent] = useState<SheetName>(null);
  // `null` tant qu'aucune note n'a été ouverte : la bulle n'est alors pas montée
  // du tout. Une fois affichée, elle reste montée (comme avant le portage React).
  const [noteBody, setNoteBody] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [pstate, setPstate] = useState<PlayerState | null>(null);
  const [sceneId, setSceneId] = useState<string | null>(null);
  // Répétition vocale : réglage global (toutes pièces), d'où sa propre clé.
  const [voice, setVoice] = useState(loadVoice);

  const playerRef = useRef<Player | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  // Le moteur est créé une seule fois, au montage : il lui faut la valeur restaurée,
  // pas celle du premier rendu figée dans la closure.
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  const hasClips = Boolean(data.audio && Object.keys(data.audio.clips).length);

  // Le moteur pilote le masquage « répétition » (réglages + rôles), même sans clips :
  // sans audio, le tap sur une réplique déplace seul la position (`seek`) et c'est elle
  // qui décide de ce qui est flouté ; avec audio, la répétition joue.
  // Créé une seule fois : `.play` ne change jamais d'identité dans le lecteur mobile
  // (pas de re-pagination, contrairement au lecteur web).
  useEffect(() => {
    // Plage de chaque tirade, pour la boucle. Calculée sur le DOM complet, masquage
    // compris : une scène remise en visibilité doit retrouver la sienne.
    const ranges = rangeIndex(play);
    const player = createPlayer({
      container: play,
      resolveAudio: (t) => Promise.resolve(data.audio?.clips[t.nodeId] ?? null),
      roles: initial.selected,
      settings: initial.reading,
      onState: setPstate,
      speakingClass: 'line--speaking',
      rangeOf: (t) => ranges.get(t.nodeId) ?? null,
      // Sans reconnaissance (le .html exporté), le moteur ignore tout du mode vocal
      // et la pause de répétition reste celle d'avant.
      voice: recognizer
        ? { recognizer, enabled: voiceRef.current.enabled, tolerance: voiceRef.current.tolerance }
        : undefined,
    });
    player.setRate(rate);
    playerRef.current = player;

    const onClick = (e: MouseEvent) => {
      const t = e.target;
      if (!(t instanceof Element)) return; // ex. clic sur un nœud texte
      const line = t.closest('.line') as HTMLElement | null;
      if (!line) return;
      const nid = line.getAttribute('data-nid');
      if (!nid) return;
      // Taper une réplique, c'est s'y placer : le masquage se déduit de la position
      // (avant elle = dit, donc en clair ; à partir d'elle = flouté). Sans clips il n'y
      // a rien à jouer, mais la position doit bouger quand même — c'est le seul geste
      // de navigation dont dispose alors le lecteur.
      if (hasClips) player.playFrom(nid);
      else player.seek(nid);
    };
    play.addEventListener('click', onClick);

    // Notes (figées dans l'export) : surlignage + bulle en lecture seule.
    // Après le moteur, comme avant le portage : il indexe les répliques au montage.
    if (data.notes && data.notes.length) {
      const byId = new Map(data.notes.map((n) => [n.id, n]));
      decorate(play, data.notes, {
        onActivate: (id) => {
          setNoteBody(byId.get(id)?.body ?? '');
          setSheet('note');
        },
      });
    }

    return () => {
      play.removeEventListener('click', onClick);
      player.destroy();
      playerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- montage seul, par conception
  }, []);

  // Scène courante, pour le bandeau : le dernier en-tête franchi. L'observateur
  // émet un premier lot dès le branchement, ce qui initialise le bandeau sans
  // écouter le défilement.
  useEffect(() => {
    const els = data.toc
      .map((e) => document.getElementById(e.id))
      .filter((el): el is HTMLElement => el !== null);
    if (!els.length) return;
    const crossed = new Set<string>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) crossed.add(e.target.id);
          else crossed.delete(e.target.id);
        }
        // `els` est en ordre de document : le dernier franchi est le courant.
        let current: string | null = null;
        for (const el of els) if (crossed.has(el.id)) current = el.id;
        setSceneId(current);
      },
      { rootMargin: SCENE_ROOT_MARGIN },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- le sommaire est figé à l'export
  }, []);

  const sceneLabel = useMemo(
    () => (sceneId ? (data.toc.find((e) => e.id === sceneId)?.label ?? null) : null),
    [data.toc, sceneId],
  );

  // Point de reprise offert à l'écran d'accueil de l'app. Il ne s'efface JAMAIS
  // de lui-même : avant le premier en-tête — page de titre, distribution — la
  // scène courante est nulle, et remonter là-haut une seconde n'est pas une
  // demande d'oublier où on en était.
  const [resume, setResume] = useState(initial.resume);
  useEffect(() => {
    if (sceneId && sceneLabel) setResume({ sceneId, label: sceneLabel, at: Date.now() });
  }, [sceneId, sceneLabel]);

  // Taille du texte : posée en inline sur `.play`. useLayoutEffect (et non
  // useEffect) pour que la valeur restaurée soit appliquée avant la peinture,
  // sinon le texte s'affiche brièvement à 100 %.
  useLayoutEffect(() => {
    play.style.fontSize = `${fontPct}%`;
  }, [play, fontPct]);

  // Coloration des personnages sélectionnés (le masquage « répétition » est
  // piloté par le moteur audio via le mode de lecture + mon rôle).
  useLayoutEffect(() => {
    play.querySelectorAll<HTMLElement>('.line').forEach((line) => {
      const cid = line.getAttribute('data-cid');
      const idx = cid ? selected.indexOf(cid) : -1;
      line.style.backgroundColor = idx >= 0 ? colorFor(idx) : '';
    });
  }, [play, selected]);

  // Option « n'afficher que mes scènes ». La RÈGLE est dans @theatre/core, partagée
  // avec le lecteur web : lui filtre l'AST, nous masquons le DOM, mais à partir du
  // même verdict — une règle réécrite ici est ce qui avait laissé le contenu
  // hors-scène (prologue d'acte, tête de pièce) échapper au filtre.
  const visibility = useMemo(
    () => sceneVisibility(data.sceneMembers, reading.onlyMyScenes ? selected : []),
    [reading.onlyMyScenes, selected, data.sceneMembers],
  );

  // Applique le masquage, puis réindexe le player pour qu'il saute ces répliques.
  // useLayoutEffect : pas de flash des scènes exclues au montage (état persisté),
  // et il passe AVANT le useEffect qui crée le player — lequel indexe donc un DOM
  // déjà masqué (`refresh()` est alors un no-op, `playerRef` étant encore nul).
  useLayoutEffect(() => {
    applySceneVisibility(play, visibility);
    playerRef.current?.refresh();
  }, [play, visibility]);

  // Après un changement de visibilité, re-marque la recherche : sinon des
  // occurrences dans des scènes désormais masquées resteraient comptées et
  // « cadrées dans le vide ». Rien à faire tant qu'aucune recherche n'est active.
  useEffect(() => {
    if (query) search.run(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- déclenché par le filtre, pas la frappe (gérée par onInput)
  }, [visibility]);

  // Persistance : un seul point d'écriture, sauté au montage pour ne pas
  // réécrire l'état qu'on vient tout juste de lire.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    saveState(data.storageKey, { selected, fontPct, reading, resume });
  }, [data.storageKey, selected, fontPct, reading, resume]);

  // Le champ de recherche n'est focalisé qu'à l'ouverture de sa sheet.
  useEffect(() => {
    if (sheet === 'search') searchInputRef.current?.focus();
  }, [sheet]);

  const closeSheet = (): void => setSheet(null);

  /** Ouvre une sheet ; `from` la marque comme empilée sur une autre. */
  const openSheet = (name: SheetName, from: SheetName = null): void => {
    setParent(from);
    setSheet(name);
  };
  // Une même sheet est atteignable depuis la barre (sans retour) ou depuis
  // « Options » (avec retour) : c'est `parent` qui tranche, pas la sheet.
  const backToParent = parent ? () => setSheet(parent) : undefined;

  // Une seule liste : cocher un personnage le surligne ET en fait un de mes rôles,
  // d'où la propagation au moteur — c'est elle qui pilote masquage et pauses.
  const toggleCharacter = (cid: string): void => {
    const next = selected.includes(cid) ? selected.filter((x) => x !== cid) : [...selected, cid];
    setSelected(next);
    playerRef.current?.setRoles(next);
  };

  const changeSettings = (patch: Partial<ReadingSettings>): void => {
    setReading((prev) => ({ ...prev, ...patch }));
    playerRef.current?.setSettings(patch);
  };

  const changeVoice = (patch: { enabled?: boolean; tolerance?: Tolerance }): void => {
    setVoice((prev) => {
      const next = { ...prev, ...patch };
      saveVoice(next);
      return next;
    });
    playerRef.current?.setVoice(patch);
    // Deux réglages deviennent contradictoires dès que l'écoute décide de la reprise :
    // « Me faire répéter » rejouerait la tirade qu'on vient de dire, et l'avancement
    // automatique couperait la parole au bout de son minuteur. On les éteint plutôt
    // que de les laisser cochés sans effet.
    if (patch.enabled) changeSettings({ playMine: false, autoAdvance: false });
  };

  const cycleRate = (): void => {
    const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length] ?? 1;
    setRate(next);
    saveRate(next);
    playerRef.current?.setRate(next);
  };

  const toggleLoop = (): void => {
    const p = playerRef.current;
    p?.setLoop(!loop);
    // Relu du moteur plutôt que posé à l'aveugle : lui seul sait s'il a de quoi
    // découper les plages, et un bouton allumé qui ne boucle pas serait pire que
    // pas de bouton du tout.
    setLoop(p?.getState().loop ?? false);
  };

  const goToEntry = (id: string): void => {
    setSheet(null);
    document.getElementById(id)?.scrollIntoView({ block: 'start' });
  };

  const playing = Boolean(pstate?.playing && !pstate.waitingForUser);
  /** Le mode vocal ne s'applique que dans la répétition, comme le moteur l'entend. */
  const voiceOn = Boolean(recognizer) && voice.enabled && reading.rehearsal;

  return (
    <>
      <div className="reader-dock">
        <VoiceFeedback status={pstate?.voice ?? null} />
        {/* Le « à toi » du bandeau s'efface quand la validation vocale est en place :
            elle le dit mieux, et en disant aussi ce qui se passe ensuite. */}
        <ContextBanner
          scene={sceneLabel}
          waiting={Boolean(pstate?.waitingForUser) && !pstate?.voice}
        />

        <Toolbar className="reader-bar" aria-label="Commandes du lecteur">
          <ToolbarGroup className="reader-bar-side" label={hasClips ? 'Menu et boucle' : 'Menu'}>
            <IconButton
              icon="menu"
              label="Options"
              size="touch"
              aria-haspopup="dialog"
              onClick={() => openSheet('options')}
            />
            {/* Contrepoids exact de la vitesse + Répétition à droite : les deux zones
                latérales font alors la même largeur, et le transport est réellement
                centré et non simplement flexé. */}
            {hasClips && (
              <IconButton
                icon="repeat"
                label="Boucler la scène"
                size="touch"
                pressed={loop}
                onClick={toggleLoop}
              />
            )}
          </ToolbarGroup>

          {hasClips ? (
            <TransportDock
              playing={playing}
              waiting={Boolean(pstate?.waitingForUser)}
              onPrev={() => playerRef.current?.prev()}
              onToggle={() => {
                const p = playerRef.current;
                if (!p) return;
                if (pstate?.waitingForUser) p.resume();
                else p.toggle();
              }}
              onNext={() => playerRef.current?.next()}
              rehearsal={reading.rehearsal}
              onRehearsalChange={(on) => changeSettings({ rehearsal: on })}
              rate={rate}
              onRateCycle={cycleRate}
            />
          ) : (
            <>
              <ToolbarGroup label="Navigation">
                <IconButton
                  icon="users"
                  label="Mes personnages"
                  size="touch"
                  aria-haspopup="dialog"
                  onClick={() => openSheet('chars')}
                />
                <IconButton
                  icon="list"
                  label="Scènes"
                  size="touch"
                  aria-haspopup="dialog"
                  onClick={() => openSheet('scenes')}
                />
                <IconButton
                  icon="search"
                  label="Recherche"
                  size="touch"
                  aria-haspopup="dialog"
                  onClick={() => openSheet('search')}
                />
              </ToolbarGroup>
              {/* Contrepoids de la zone du menu : c'est lui qui centre la zone
                  du milieu, les deux côtés ayant la même souplesse. */}
              <div className="reader-bar-side" aria-hidden="true" />
            </>
          )}
        </Toolbar>
      </div>

      {/* Toutes les sheets sont montées en permanence et n'échangent que leur
          état ouvert : leur transition CSS (translateY) ne jouerait pas si elles
          apparaissaient déjà ouvertes au montage. */}
      <Sheet title="Options" open={sheet === 'options'} onClose={closeSheet}>
        {/* Dans son propre bloc, au-dessus de la navigation interne : quitter la
            pièce et se déplacer dedans ne sont pas la même sorte d'action. */}
        {onExit && (
          <div className="sheet-nav">
            <button type="button" className="sheet-nav-item" onClick={onExit}>
              <Icon name="chevron-left" size={20} />
              <span className="sheet-nav-label">Mes pièces</span>
            </button>
          </div>
        )}

        <div className="sheet-nav">
          <NavItem
            icon="users"
            label="Mes personnages"
            onClick={() => openSheet('chars', 'options')}
          />
          <NavItem icon="list" label="Scènes" onClick={() => openSheet('scenes', 'options')} />
          <NavItem icon="search" label="Recherche" onClick={() => openSheet('search', 'options')} />
          <NavItem
            icon="sliders"
            label="Mode de lecture"
            hint={reading.rehearsal ? 'Répétition' : 'Continu'}
            onClick={() => openSheet('mode', 'options')}
          />
        </div>

        {/* Un curseur plutôt qu'un couple A−/A+ : deux boutons pour parcourir
            70 → 220 % demandaient une quinzaine de taps. */}
        <div className="sheet-field">
          <div className="sheet-field-head">
            <span className="sheet-field-label">
              <Icon name="type" size={18} /> Taille du texte
            </span>
            <span className="sheet-field-value">{fontPct} %</span>
          </div>
          <input
            className="sheet-slider"
            type="range"
            min={FONT_MIN}
            max={FONT_MAX}
            step={5}
            value={fontPct}
            aria-label="Taille du texte, en pourcentage"
            onInput={(ev) => setFontPct(clampFont(Number((ev.target as HTMLInputElement).value)))}
          />
        </div>
      </Sheet>

      <Sheet title="Mes personnages" open={sheet === 'chars'} onClose={closeSheet} onBack={backToParent}>
        <p className="sheet-intro">
          Leurs répliques sont surlignées, et ce sont elles que la répétition masque et
          attend de vous.
        </p>
        {data.characters.map((c) => {
          const idx = selected.indexOf(c.id);
          return (
            <label className="row" key={c.id}>
              <input
                type="checkbox"
                checked={idx >= 0}
                onChange={() => toggleCharacter(c.id)}
              />
              {c.name}
              <span
                className="swatch"
                data-cid={c.id}
                style={{ background: idx >= 0 ? colorFor(idx) : 'transparent' }}
              />
            </label>
          );
        })}
      </Sheet>

      <Sheet title="Aller à une scène" open={sheet === 'scenes'} onClose={closeSheet} onBack={backToParent}>
        {/* `headings` et non `ranges` : un acte dont seul le prologue tombe garde
            son en-tête dans le document, donc reste une destination valide. */}
        {data.toc.filter((e) => !visibility.headings.has(e.id)).map((e) => (
          <div className="row" key={e.id}>
            <a
              className={`scene-link${e.scene ? ' is-scene' : ''}`}
              href={`#${e.id}`}
              onClick={(ev) => {
                ev.preventDefault();
                goToEntry(e.id);
              }}
            >
              {e.label}
            </a>
          </div>
        ))}
      </Sheet>

      <Sheet title="Recherche" open={sheet === 'search'} onClose={closeSheet} onBack={backToParent}>
        <div className="reader-search">
          <input
            ref={searchInputRef}
            type="search"
            placeholder="Rechercher…"
            value={query}
            onInput={(ev) => {
              const v = ev.currentTarget.value;
              setQuery(v);
              search.run(v);
            }}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter') search.step(ev.shiftKey ? -1 : 1);
            }}
          />
          <IconButton
            icon="chevron-down"
            label="Occurrence précédente"
            size="touch"
            className="reader-search-prev"
            onClick={() => search.step(-1)}
          />
          <IconButton
            icon="chevron-down"
            label="Occurrence suivante"
            size="touch"
            onClick={() => search.step(1)}
          />
        </div>
      </Sheet>

      <Sheet title="Mode de lecture" open={sheet === 'mode'} onClose={closeSheet} onBack={backToParent}>
        {/* Interrupteur maître : Continu / Répétition. Le même `Button` que la
            bascule de la barre — c'est le même état, il doit se lire pareil. */}
        <div className="mode-seg">
          {[
            { on: false, label: 'Continu' },
            { on: true, label: 'Répétition' },
          ].map((m) => (
            <Button
              key={m.label}
              size="touch"
              aria-pressed={reading.rehearsal === m.on}
              onClick={() => changeSettings({ rehearsal: m.on })}
            >
              {m.label}
            </Button>
          ))}
        </div>

        {/* Options de répétition (indépendantes). */}
        {REHEARSAL_OPTIONS.map((o) => {
          // Grisées, et pas seulement ignorées : cochées sans effet, elles feraient
          // croire à un réglage qui ne s'applique pas (cf. `changeVoice`).
          const mutedByVoice = voiceOn && (o.key === 'playMine' || o.key === 'autoAdvance');
          return (
            <label className="row" key={o.key}>
              <input
                type="checkbox"
                checked={reading[o.key] && !mutedByVoice}
                disabled={!reading.rehearsal || mutedByVoice}
                onChange={(ev) =>
                  changeSettings({ [o.key]: ev.currentTarget.checked } as Partial<ReadingSettings>)
                }
              />
              {o.label}
              <span className="mode-hint">
                {mutedByVoice ? 'Remplacé par la validation vocale.' : o.hint}
              </span>
            </label>
          );
        })}

        {/* Validation vocale — seulement là où il y a une reconnaissance à piloter. */}
        {recognizer && (
          <>
            <label className="row">
              <input
                type="checkbox"
                checked={voice.enabled}
                disabled={!reading.rehearsal}
                onChange={(ev) => changeVoice({ enabled: ev.currentTarget.checked })}
              />
              Validation vocale
              <span className="mode-hint">
                Le micro s'ouvre sur mes répliques et attend que je les dise.
              </span>
            </label>

            {voiceOn && (
              <div className="mode-seg mode-seg--sub" role="group" aria-label="Exigence de la validation">
                {[
                  { key: 'soft' as const, label: 'Souple' },
                  { key: 'strict' as const, label: 'Strict' },
                ].map((t) => (
                  <Button
                    key={t.key}
                    size="touch"
                    aria-pressed={voice.tolerance === t.key}
                    onClick={() => changeVoice({ tolerance: t.key })}
                  >
                    {t.label}
                  </Button>
                ))}
              </div>
            )}
          </>
        )}

        {/* N'afficher que mes scènes — indépendant du mode (toujours disponible),
            désactivé tant qu'aucun personnage n'est coché. La liste des personnages
            vit dans sa propre sheet : la dupliquer ici était le doublon qu'on a retiré. */}
        <label className="row">
          <input
            type="checkbox"
            checked={reading.onlyMyScenes}
            disabled={selected.length === 0}
            onChange={(ev) => changeSettings({ onlyMyScenes: ev.currentTarget.checked })}
          />
          N'afficher que mes scènes
          <span className="mode-hint">
            {selected.length === 0
              ? 'Cocher un personnage dans Options › Mes personnages.'
              : 'Masque les scènes où je ne joue pas.'}
          </span>
        </label>

        <div className="sheet-nav">
          <NavItem
            icon="users"
            label="Mes personnages"
            hint={selected.length ? String(selected.length) : 'aucun'}
            onClick={() => openSheet('chars', 'mode')}
          />
        </div>
      </Sheet>

      {noteBody !== null && (
        <Sheet title="Note" open={sheet === 'note'} onClose={closeSheet}>
          <p className="reader-note-body" style={{ whiteSpace: 'pre-wrap' }}>
            {noteBody}
          </p>
        </Sheet>
      )}
    </>
  );
}

/** Entrée de la sheet « Options » qui ouvre une autre sheet. */
function NavItem({
  icon,
  label,
  hint,
  onClick,
}: {
  icon: 'users' | 'list' | 'search' | 'sliders';
  label: string;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="sheet-nav-item" aria-haspopup="dialog" onClick={onClick}>
      <Icon name={icon} size={20} />
      <span className="sheet-nav-label">{label}</span>
      {hint && <span className="sheet-nav-hint">{hint}</span>}
      <Icon name="chevron-right" size={18} className="sheet-nav-chevron" />
    </button>
  );
}
