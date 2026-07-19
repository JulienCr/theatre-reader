/**
 * Chrome du lecteur mobile : barre du bas, sheets, backdrop.
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
 * des personnages) : s'il rendait `.play`, il écraserait les mutations ci-dessus.
 * Même patron que `packages/web/src/components/Reader.tsx`.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { decorate } from '@theatre/annotations';
import {
  createPlayer,
  type Player,
  type PlayerState,
  type ReadingSettings,
} from '@theatre/audio-player';
import type { SearchController } from '@theatre/reader-ui';
import { colorFor, FONT_MAX, FONT_MIN, saveState, type PersistedState } from './state';
import type { ReaderData } from './types';

type SheetName = 'chars' | 'scenes' | 'search' | 'mode' | 'note' | null;

const clampFont = (p: number): number => Math.min(FONT_MAX, Math.max(FONT_MIN, p));

/** Options de répétition, dans l'ordre d'affichage. */
const REHEARSAL_OPTIONS: { key: keyof ReadingSettings; label: string; hint: string }[] = [
  { key: 'mask', label: 'Masquer mes répliques', hint: "Floutées jusqu'à ce qu'elles soient dites." },
  { key: 'playMine', label: 'Me faire répéter', hint: 'À la reprise, le TTS lit ma réplique.' },
  { key: 'autoAdvance', label: 'Avancement automatique', hint: 'Reprise auto après la durée, sans clic.' },
  { key: 'tick', label: "Bip quand c'est à moi", hint: '' },
];

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
  // `null` tant qu'aucune note n'a été ouverte : la bulle n'est alors pas montée
  // du tout. Le chrome vanilla la créait à la demande, et une `.reader-sheet`
  // fermée projette quand même son ombre au-dessus d'elle — une bulle montée
  // d'avance assombrirait le bas de l'écran. Une fois affichée, elle reste
  // montée (là aussi comme avant le portage).
  const [noteBody, setNoteBody] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [pstate, setPstate] = useState<PlayerState | null>(null);

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

  const toggleCharacter = (cid: string): void =>
    setSelected((prev) => (prev.includes(cid) ? prev.filter((x) => x !== cid) : [...prev, cid]));

  const bumpFont = (delta: number): void => setFontPct((p) => clampFont(p + delta));

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
      <div className={`reader-backdrop${sheet ? ' open' : ''}`} onClick={() => setSheet(null)} />

      <div className="reader-bar">
        <button onClick={() => setSheet('chars')}>Persos</button>
        <button onClick={() => setSheet('scenes')}>Scènes</button>
        <button onClick={() => setSheet('search')}>🔍</button>
        <button aria-haspopup="dialog" onClick={() => setSheet('mode')}>
          Mode
        </button>
        <button onClick={() => bumpFont(-10)}>A−</button>
        <button onClick={() => bumpFont(10)}>A+</button>
        {/* Transport audio (uniquement si des clips sont embarqués). */}
        {hasClips && (
          <>
            <button
              onClick={() => {
                const p = playerRef.current;
                if (!p) return;
                if (pstate?.waitingForUser) p.resume();
                else p.toggle();
              }}
            >
              {playing ? '⏸' : '▶'}
            </button>
            <button onClick={() => playerRef.current?.next()}>⏭</button>
          </>
        )}
      </div>

      {/* Toutes les sheets sont montées en permanence et n'échangent que la classe
          `open` : leur transition CSS (translateY) ne jouerait pas si elles
          apparaissaient déjà ouvertes au montage. */}
      <Sheet title="Personnages à surligner" open={sheet === 'chars'}>
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

      <Sheet title="Aller à une scène" open={sheet === 'scenes'}>
        {data.toc.map((e) => (
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

      <Sheet title="Recherche" open={sheet === 'search'}>
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
          <button onClick={() => search.step(-1)}>‹</button>
          <button onClick={() => search.step(1)}>›</button>
        </div>
      </Sheet>

      <Sheet title="Mode de lecture" open={sheet === 'mode'}>
        {/* Interrupteur maître : Continu / Répétition. */}
        <div className="mode-seg">
          {[
            { on: false, label: 'Continu' },
            { on: true, label: 'Répétition' },
          ].map((m) => (
            <button
              key={m.label}
              type="button"
              aria-pressed={reading.rehearsal === m.on}
              onClick={() => changeSettings({ rehearsal: m.on })}
            >
              {m.label}
            </button>
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
        <Sheet title="Note" open={sheet === 'note'} id="reader-note">
          <p className="reader-note-body" style={{ whiteSpace: 'pre-wrap' }}>
            {noteBody}
          </p>
        </Sheet>
      )}
    </>
  );
}

/** Panneau glissant depuis le bas. Identique au chrome vanilla d'origine. */
function Sheet({
  title,
  open,
  id,
  children,
}: {
  title: string;
  open: boolean;
  id?: string;
  children: ReactNode;
}) {
  return (
    <div className={`reader-sheet${open ? ' open' : ''}`} id={id}>
      <h2>{title}</h2>
      {children}
    </div>
  );
}
