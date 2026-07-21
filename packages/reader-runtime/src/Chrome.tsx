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
  HIDDEN_SCENE_CLASS,
  type Player,
  type PlayerState,
  type ReadingSettings,
} from '@theatre/audio-player';
import { ContextBanner, TransportDock, type SearchController } from '@theatre/reader-ui';
import { Button, Icon, IconButton, Sheet, Toolbar, ToolbarGroup } from '@theatre/ui';
import { colorFor, FONT_MAX, FONT_MIN, saveState, type PersistedState } from './state';
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
}: {
  data: ReaderData;
  /** Le `.play` rendu par @theatre/core — jamais rendu par React, seulement muté. */
  play: HTMLElement;
  search: SearchController;
  initial: PersistedState;
}) {
  const [selected, setSelected] = useState<string[]>(initial.selected);
  // Borné dès la lecture : un localStorage abîmé ne doit pas rendre la pièce illisible.
  const [fontPct, setFontPct] = useState(clampFont(initial.fontPct));
  const [reading, setReading] = useState<ReadingSettings>(initial.reading);
  const [myRoles, setMyRoles] = useState<string[]>(initial.myRoles);
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

  const playerRef = useRef<Player | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const hasClips = Boolean(data.audio && Object.keys(data.audio.clips).length);

  // Le moteur pilote le masquage « répétition » (réglages + rôles), même sans clips :
  // sans audio, on garde le déroulé + tap-to-peek ; avec audio, la répétition joue.
  // Créé une seule fois : `.play` ne change jamais d'identité dans le lecteur mobile
  // (pas de re-pagination, contrairement au lecteur web).
  useEffect(() => {
    const player = createPlayer({
      container: play,
      resolveAudio: (t) => Promise.resolve(data.audio?.clips[t.nodeId] ?? null),
      roles: initial.myRoles,
      settings: initial.reading,
      onState: setPstate,
      speakingClass: 'line--speaking',
    });
    playerRef.current = player;

    const onClick = (e: MouseEvent) => {
      const t = e.target;
      if (!(t instanceof Element)) return; // ex. clic sur un nœud texte
      const line = t.closest('.line') as HTMLElement | null;
      if (!line) return;
      const nid = line.getAttribute('data-nid');
      // Réplique masquée : un tap la révèle (peek), sans la jouer.
      if (line.classList.contains('line--masked')) {
        if (nid) player.reveal(nid);
        return;
      }
      // Sinon : cliquer une réplique la joue (si audio embarqué).
      if (hasClips && nid) player.playFrom(nid);
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

  // Option « n'afficher que mes scènes » : ids d'en-têtes à masquer — les scènes
  // où aucun de mes rôles ne joue, plus les actes dont TOUTES les scènes tombent.
  // Calculé depuis la présence embarquée à l'export (le runtime n'a pas l'AST).
  const hiddenIds = useMemo(() => {
    const hidden = new Set<string>();
    if (!reading.onlyMyScenes || !myRoles.length) return hidden;
    const roles = new Set(myRoles);
    for (const s of data.sceneMembers) {
      if (!s.characterIds.some((c) => roles.has(c))) hidden.add(s.id);
    }
    // Acte vidé : dans le sommaire (ordonné), aucune de ses scènes n'a survécu.
    const toc = data.toc;
    for (let i = 0; i < toc.length; i++) {
      if (toc[i]!.scene) continue;
      let j = i + 1;
      let anyKept = false;
      for (; j < toc.length && toc[j]!.scene; j++) if (!hidden.has(toc[j]!.id)) anyKept = true;
      if (j > i + 1 && !anyKept) hidden.add(toc[i]!.id);
    }
    return hidden;
  }, [reading.onlyMyScenes, myRoles, data.sceneMembers, data.toc]);

  // Masque les plages DOM des en-têtes exclus (l'en-tête + ses frères jusqu'au
  // prochain en-tête), puis réindexe le player pour qu'il saute ces répliques.
  // useLayoutEffect : pas de flash des scènes exclues au montage (état persisté).
  useLayoutEffect(() => {
    const HEAD = 'h2.act, h3.scene';
    play.querySelectorAll<HTMLElement>(HEAD).forEach((h) => {
      const hide = hiddenIds.has(h.id);
      let el: Element | null = h;
      while (el) {
        el.classList.toggle(HIDDEN_SCENE_CLASS, hide);
        const next: Element | null = el.nextElementSibling;
        if (!next || next.matches(HEAD)) break;
        el = next;
      }
    });
    playerRef.current?.refresh();
  }, [play, hiddenIds]);

  // Après un changement de visibilité, re-marque la recherche : sinon des
  // occurrences dans des scènes désormais masquées resteraient comptées et
  // « cadrées dans le vide ». Rien à faire tant qu'aucune recherche n'est active.
  useEffect(() => {
    if (query) search.run(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- déclenché par le filtre, pas la frappe (gérée par onInput)
  }, [hiddenIds]);

  // Persistance : un seul point d'écriture, sauté au montage pour ne pas
  // réécrire l'état qu'on vient tout juste de lire.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    saveState(data.storageKey, { selected, fontPct, reading, myRoles });
  }, [data.storageKey, selected, fontPct, reading, myRoles]);

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

  const toggleCharacter = (cid: string): void =>
    setSelected((prev) => (prev.includes(cid) ? prev.filter((x) => x !== cid) : [...prev, cid]));

  const changeSettings = (patch: Partial<ReadingSettings>): void => {
    setReading((prev) => ({ ...prev, ...patch }));
    playerRef.current?.setSettings(patch);
  };

  const changeRoles = (cids: string[]): void => {
    setMyRoles(cids);
    playerRef.current?.setRoles(cids);
  };

  const goToEntry = (id: string): void => {
    setSheet(null);
    document.getElementById(id)?.scrollIntoView({ block: 'start' });
  };

  const playing = Boolean(pstate?.playing && !pstate.waitingForUser);

  return (
    <>
      <div className="reader-dock">
        <ContextBanner scene={sceneLabel} waiting={Boolean(pstate?.waitingForUser)} />

        <Toolbar className="reader-bar" aria-label="Commandes du lecteur">
          <ToolbarGroup className="reader-bar-side" label="Menu">
            <IconButton
              icon="menu"
              label="Options"
              size="touch"
              aria-haspopup="dialog"
              onClick={() => openSheet('options')}
            />
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
            />
          ) : (
            <>
              <ToolbarGroup label="Navigation">
                <IconButton
                  icon="users"
                  label="Personnages"
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
        <div className="sheet-nav">
          <NavItem icon="users" label="Personnages" onClick={() => openSheet('chars', 'options')} />
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

      <Sheet title="Personnages à surligner" open={sheet === 'chars'} onClose={closeSheet} onBack={backToParent}>
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
        {data.toc.filter((e) => !hiddenIds.has(e.id)).map((e) => (
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
        {REHEARSAL_OPTIONS.map((o) => (
          <label className="row" key={o.key}>
            <input
              type="checkbox"
              checked={reading[o.key]}
              disabled={!reading.rehearsal}
              onChange={(ev) =>
                changeSettings({ [o.key]: ev.currentTarget.checked } as Partial<ReadingSettings>)
              }
            />
            {o.label}
            {o.hint && <span className="mode-hint">{o.hint}</span>}
          </label>
        ))}

        {/* N'afficher que mes scènes — indépendant du mode (toujours disponible),
            désactivé tant qu'aucun rôle n'est choisi. */}
        <label className="row">
          <input
            type="checkbox"
            checked={reading.onlyMyScenes}
            disabled={myRoles.length === 0}
            onChange={(ev) => changeSettings({ onlyMyScenes: ev.currentTarget.checked })}
          />
          N'afficher que mes scènes
          <span className="mode-hint">
            {myRoles.length === 0 ? 'Choisir un rôle ci-dessous.' : 'Masque les scènes où je ne joue pas.'}
          </span>
        </label>

        {/* Mes rôles (multi-sélection). */}
        <div className="mode-subhead">Mes rôles</div>
        {data.characters.map((ch) => (
          <label className="row" key={ch.id}>
            <input
              type="checkbox"
              value={ch.id}
              checked={myRoles.includes(ch.id)}
              onChange={(ev) =>
                changeRoles(
                  ev.currentTarget.checked
                    ? [...myRoles, ch.id]
                    : myRoles.filter((r) => r !== ch.id),
                )
              }
            />
            {ch.name}
          </label>
        ))}
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
