/**
 * Moteur de lecture audio des tirades — framework-free, réutilisé par le lecteur
 * web (React, en ligne : audio récupéré du serveur à la demande) ET le runtime
 * mobile hors-ligne (vanilla : data URI embarquées).
 *
 * Il marche les `<p class="line" data-cid data-nid>` du conteneur (rendu canonique
 * de @theatre/core), joue chaque tirade dans la voix de son personnage, surligne +
 * fait défiler la réplique courante, et gère le mode Répétition (pause silencieuse
 * sur le rôle joué). La récupération de l'audio est injectée via `resolveAudio`,
 * qui doit être idempotent (il peut être appelé en préfetch de la tirade suivante).
 */

export interface AudioTirade {
  nodeId: string;
  characterId: string;
  element: HTMLElement;
  text: string;
}

export type PlaybackMode = 'continuous' | 'rehearsal';

export interface PlayerState {
  playing: boolean;
  mode: PlaybackMode;
  index: number;
  total: number;
  currentNodeId: string | null;
  currentCharacterId: string | null;
  /** En Répétition, vrai quand on attend que l'utilisateur dise sa réplique. */
  waitingForUser: boolean;
}

export interface PlayerOptions {
  container: HTMLElement;
  /** Renvoie l'URL/data URI de l'audio d'une tirade, ou null si pas d'audio (skip). Idempotent. */
  resolveAudio: (t: AudioTirade) => Promise<string | null>;
  /** Vrai pour le rôle joué par l'utilisateur (pause en Répétition). */
  isMine?: (characterId: string) => boolean;
  onState?: (s: PlayerState) => void;
  onError?: (msg: string) => void;
  /** Classe CSS posée sur la tirade en cours (défaut 'line--speaking'). */
  speakingClass?: string;
}

export interface Player {
  play(): void;
  pause(): void;
  toggle(): void;
  next(): void;
  prev(): void;
  /** Joue une tirade précise (clic sur une réplique). */
  playFrom(nodeId: string): void;
  setMode(mode: PlaybackMode): void;
  setRate(rate: number): void;
  /** Reconstruit la liste des tirades (après re-pagination), en gardant la position. */
  refresh(): void;
  getState(): PlayerState;
  destroy(): void;
}

function collectTirades(container: HTMLElement): AudioTirade[] {
  const out: AudioTirade[] = [];
  const seen = new Set<string>();
  container.querySelectorAll<HTMLElement>('p.line').forEach((el) => {
    const nodeId = el.getAttribute('data-nid');
    const characterId = el.getAttribute('data-cid');
    if (!nodeId || !characterId) return;
    // Paged.js peut fragmenter une même réplique sur 2 pages : on garde la 1re.
    if (seen.has(nodeId)) return;
    const text = Array.from(el.querySelectorAll<HTMLElement>('.speech'))
      .map((s) => s.textContent ?? '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) return;
    seen.add(nodeId);
    out.push({ nodeId, characterId, element: el, text });
  });
  return out;
}

export function createPlayer(opts: PlayerOptions): Player {
  const speakingClass = opts.speakingClass ?? 'line--speaking';
  const audio = document.createElement('audio');
  audio.preload = 'auto';

  let tirades = collectTirades(opts.container);
  let index = 0;
  let playing = false;
  let waitingForUser = false;
  let mode: PlaybackMode = 'continuous';
  let rate = 1;
  let destroyed = false;
  let token = 0; // invalide les résolutions asynchrones dépassées
  let highlighted: HTMLElement | null = null;

  const isMine = (cid: string) => Boolean(opts.isMine?.(cid));

  function snapshot(): PlayerState {
    const t = tirades[index];
    return {
      playing,
      mode,
      index,
      total: tirades.length,
      currentNodeId: t?.nodeId ?? null,
      currentCharacterId: t?.characterId ?? null,
      waitingForUser,
    };
  }
  function emit(): void {
    opts.onState?.(snapshot());
  }

  function clearHighlight(): void {
    if (highlighted) {
      highlighted.classList.remove(speakingClass);
      highlighted = null;
    }
  }
  function highlight(el: HTMLElement): void {
    clearHighlight();
    el.classList.add(speakingClass);
    highlighted = el;
    el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }

  function stopAudio(): void {
    try {
      audio.pause();
    } catch {
      /* ignore */
    }
  }

  async function playIndex(i: number): Promise<void> {
    token++;
    const my = token;
    stopAudio();
    if (i < 0 || i >= tirades.length) {
      playing = false;
      waitingForUser = false;
      clearHighlight();
      emit();
      return;
    }
    index = i;
    const t = tirades[i]!;
    highlight(t.element);

    // Répétition : pause silencieuse sur mon rôle, on attend next().
    if (mode === 'rehearsal' && isMine(t.characterId)) {
      waitingForUser = true;
      emit();
      return;
    }
    waitingForUser = false;
    emit();

    let url: string | null = null;
    let failed = false;
    try {
      url = await opts.resolveAudio(t);
    } catch (e) {
      failed = true;
      opts.onError?.(e instanceof Error ? e.message : String(e));
    }
    if (destroyed || my !== token) return; // dépassé par une autre action

    if (failed) {
      // Échec de synthèse : on s'arrête (sinon on martèle le serveur en boucle).
      playing = false;
      emit();
      return;
    }
    if (!url) {
      // Pas d'audio (perso sans voix) : on enchaîne en lecture continue.
      if (playing && mode === 'continuous') void playIndex(i + 1);
      return;
    }

    audio.src = url;
    audio.playbackRate = rate;
    const p = audio.play();
    if (p && typeof p.catch === 'function') {
      p.catch((e: unknown) => {
        if (destroyed || my !== token) return;
        opts.onError?.(e instanceof Error ? e.message : String(e));
      });
    }
    prefetch(i + 1);
  }

  function prefetch(i: number): void {
    const t = tirades[i];
    if (!t) return;
    if (mode === 'rehearsal' && isMine(t.characterId)) return;
    // Idempotent côté hôte (URL mémoïsée) : on jette le résultat.
    void Promise.resolve(opts.resolveAudio(t)).catch(() => {});
  }

  function onEnded(): void {
    if (destroyed || !playing) return;
    void playIndex(index + 1);
  }
  audio.addEventListener('ended', onEnded);

  function play(): void {
    if (playing) return;
    playing = true;
    // Reprise en cours de réplique si l'audio est en pause au milieu.
    if (audio.src && !audio.ended && audio.currentTime > 0 && !waitingForUser) {
      const p = audio.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
      emit();
      return;
    }
    void playIndex(index);
  }

  function pause(): void {
    if (!playing) return;
    playing = false;
    stopAudio();
    emit();
  }

  return {
    play,
    pause,
    toggle: () => (playing ? pause() : play()),
    next: () => {
      playing = true;
      void playIndex(index + 1);
    },
    prev: () => {
      playing = true;
      void playIndex(index - 1);
    },
    playFrom: (nodeId: string) => {
      const i = tirades.findIndex((t) => t.nodeId === nodeId);
      if (i < 0) return;
      playing = true;
      void playIndex(i);
    },
    setMode: (m: PlaybackMode) => {
      mode = m;
      emit();
    },
    setRate: (r: number) => {
      rate = r;
      audio.playbackRate = r;
    },
    refresh: () => {
      const currentId = tirades[index]?.nodeId ?? null;
      tirades = collectTirades(opts.container);
      if (currentId) {
        const i = tirades.findIndex((t) => t.nodeId === currentId);
        index = i >= 0 ? i : Math.min(index, Math.max(0, tirades.length - 1));
      } else {
        index = 0;
      }
      // Ré-accroche la surbrillance à l'élément (re-paginé) courant.
      if (playing || waitingForUser) {
        const t = tirades[index];
        if (t) highlight(t.element);
      }
      emit();
    },
    getState: snapshot,
    destroy: () => {
      destroyed = true;
      playing = false;
      audio.removeEventListener('ended', onEnded);
      stopAudio();
      audio.src = '';
      clearHighlight();
    },
  };
}
