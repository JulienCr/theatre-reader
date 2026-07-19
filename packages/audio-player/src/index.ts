/**
 * Moteur de lecture audio des tirades — framework-free, réutilisé par le lecteur
 * web (React, en ligne : audio récupéré du serveur à la demande) ET le runtime
 * mobile hors-ligne (vanilla : data URI embarquées).
 *
 * Il marche les `<p class="line" data-cid data-nid>` du conteneur (rendu canonique
 * de @theatre/core), joue chaque tirade dans la voix de son personnage, surligne +
 * fait défiler la réplique courante, et gère la « répétition » autour de MES rôles
 * (isMine) de façon modulaire (voir ReadingSettings). La récupération de l'audio est
 * injectée via `resolveAudio`, qui doit être idempotent (préfetch de la tirade
 * suivante, ou sonde de durée pour l'avancement automatique).
 */

export interface AudioTirade {
  nodeId: string;
  characterId: string;
  element: HTMLElement;
  text: string;
}

/**
 * Réglages de lecture, modulaires. Deux « modes » se résument à `rehearsal` :
 * - `rehearsal: false` → lecture continue : aucune pause, tout est lu.
 * - `rehearsal: true`  → répétition : pause sur MES répliques, modulée par :
 *   - `mask`        : masquer (flouter) mes répliques tant qu'elles ne sont pas dites.
 *   - `playMine`    : à la reprise, le TTS lit ma réplique (contrôle mémoire) ;
 *                     sinon elle est sautée.
 *   - `autoAdvance` : la pause se termine seule après la durée du mp3 de ma réplique
 *                     (sans la jouer), au lieu d'attendre un clic.
 *   - `tick`        : bip sonore quand c'est à moi.
 */
export interface ReadingSettings {
  rehearsal: boolean;
  mask: boolean;
  playMine: boolean;
  autoAdvance: boolean;
  tick: boolean;
}

const DEFAULT_SETTINGS: ReadingSettings = {
  rehearsal: false,
  mask: false,
  playMine: false,
  autoAdvance: false,
  tick: false,
};

export interface PlayerState {
  playing: boolean;
  index: number;
  total: number;
  currentNodeId: string | null;
  currentCharacterId: string | null;
  /** Vrai quand on est en pause sur mon tour : manuelle ou auto (avancement auto). */
  waitingForUser: boolean;
  /** Vrai quand la pause en cours est la pause automatique (avancement auto). */
  timed: boolean;
  /** Durée totale de la pause automatique en ms (pour un compte à rebours UI), sinon null. */
  timedMs: number | null;
  settings: ReadingSettings;
}

export interface PlayerOptions {
  container: HTMLElement;
  /** Renvoie l'URL/data URI de l'audio d'une tirade, ou null si pas d'audio (skip). Idempotent. */
  resolveAudio: (t: AudioTirade) => Promise<string | null>;
  /** Prédicat « c'est un de mes rôles » (pause en répétition). Alternative à `roles`. */
  isMine?: (characterId: string) => boolean;
  /** Mes rôles initiaux (multi-rôle). Ignoré si `isMine` est fourni. */
  roles?: string[];
  /** Réglages initiaux (fusionnés au défaut « lecture continue »). */
  settings?: Partial<ReadingSettings>;
  onState?: (s: PlayerState) => void;
  onError?: (msg: string) => void;
  /** Classe CSS posée sur la tirade en cours (défaut 'line--speaking'). */
  speakingClass?: string;
  /** Notifié quand une réplique masquée est révélée (« dite » ou tap-to-peek). */
  onReveal?: (nodeId: string) => void;
  /** Source de durée optionnelle pour l'avancement auto (secondes) ; essayée avant la sonde. */
  resolveDuration?: (t: AudioTirade) => Promise<number | null>;
  /** Classe sur les répliques masquées. Défaut 'line--masked'. */
  maskedClass?: string;
  /** Classe ajoutée quand une réplique masquée est révélée. Défaut 'line--revealed'. */
  revealedClass?: string;
}

export interface Player {
  play(): void;
  pause(): void;
  toggle(): void;
  next(): void;
  prev(): void;
  /** Joue une tirade précise (clic sur une réplique). */
  playFrom(nodeId: string): void;
  /** Résout une pause de répétition : joue ou saute ma réplique (selon playMine) ; révèle toujours. */
  resume(): void;
  /** Modifie les réglages (fusion partielle) ; re-masque et ré-évalue la position. */
  setSettings(patch: Partial<ReadingSettings>): void;
  /** Change mes rôles à la lecture ; re-masque et ré-évalue la position. */
  setRoles(characterIds: string[]): void;
  setRate(rate: number): void;
  /** Bascule l'état révélé (peek) d'une réplique masquée — pour le tap-to-peek. */
  reveal(nodeId: string): void;
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
  const maskedClass = opts.maskedClass ?? 'line--masked';
  const revealedClass = opts.revealedClass ?? 'line--revealed';
  const audio = document.createElement('audio');
  audio.preload = 'auto';

  let tirades = collectTirades(opts.container);
  let index = 0;
  let playing = false;
  let waitingForUser = false;
  let settings: ReadingSettings = { ...DEFAULT_SETTINGS, ...opts.settings };
  let mineFn: (cid: string) => boolean =
    opts.isMine ?? (opts.roles ? rolesPredicate(opts.roles) : () => false);
  let rate = 1;
  let destroyed = false;
  let token = 0; // invalide les résolutions asynchrones dépassées
  let highlighted: HTMLElement | null = null;
  let timerId: ReturnType<typeof setTimeout> | null = null;
  let timed = false;
  let timedMs: number | null = null;
  const revealed = new Set<string>(); // nodeIds déjà « dits »/peekés — survit à refresh()
  let audioCtx: AudioContext | null = null;

  function rolesPredicate(cids: string[]): (cid: string) => boolean {
    const set = new Set(cids);
    return (cid) => set.has(cid);
  }
  const isMine = (cid: string): boolean => mineFn(cid);
  const shouldMask = (): boolean => settings.rehearsal && settings.mask;

  function snapshot(): PlayerState {
    const t = tirades[index];
    return {
      playing,
      index,
      total: tirades.length,
      currentNodeId: t?.nodeId ?? null,
      currentCharacterId: t?.characterId ?? null,
      waitingForUser,
      timed,
      timedMs,
      settings: { ...settings }, // copie : l'état émis ne doit pas être mutable de l'extérieur
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

  // --- Masquage « répétition » : cache le texte de mes répliques jusqu'à ce
  //     qu'elles aient été dites. Piloté ici car le moteur possède les éléments. ---
  function fragmentsOf(nodeId: string): NodeListOf<HTMLElement> {
    const safe = nodeId.replace(/"/g, '\\"');
    return opts.container.querySelectorAll<HTMLElement>(`p.line[data-nid="${safe}"]`);
  }
  function applyMask(): void {
    opts.container
      .querySelectorAll<HTMLElement>(`.${maskedClass}`)
      .forEach((el) => el.classList.remove(maskedClass, revealedClass));
    if (!shouldMask()) return;
    opts.container.querySelectorAll<HTMLElement>('p.line[data-cid]').forEach((el) => {
      const cid = el.getAttribute('data-cid');
      if (cid && isMine(cid)) el.classList.add(maskedClass);
    });
    revealed.forEach((nid) => fragmentsOf(nid).forEach((el) => el.classList.add(revealedClass)));
  }
  function saidReveal(nodeId: string): void {
    revealed.add(nodeId);
    fragmentsOf(nodeId).forEach((el) => el.classList.add(revealedClass));
    opts.onReveal?.(nodeId);
  }
  function toggleReveal(nodeId: string): void {
    if (revealed.has(nodeId)) {
      revealed.delete(nodeId);
      fragmentsOf(nodeId).forEach((el) => el.classList.remove(revealedClass));
    } else {
      saidReveal(nodeId);
    }
  }

  // --- Tic sonore (WebAudio, auto-contenu, marche hors-ligne). ---
  function playTick(): void {
    if (!settings.tick) return;
    try {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      audioCtx ??= new Ctor();
      if (audioCtx.state === 'suspended') void audioCtx.resume();
      const t0 = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.2, t0 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.15);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.16);
    } catch {
      /* AudioContext indisponible : on ignore */
    }
  }

  // --- Pause automatique (avancement auto) : durée = celle du mp3, sans le jouer. ---
  const FALLBACK_MIN_MS = 1500;
  const FALLBACK_MAX_MS = 20000;
  function estimateMs(text: string): number {
    const words = text.trim().split(/\s+/).filter(Boolean).length; // ~150 mots/min ≈ 400 ms/mot
    return Math.min(FALLBACK_MAX_MS, Math.max(FALLBACK_MIN_MS, words * 400 + 400));
  }
  // Barre de progression du minuteur, en haut du bloc de la tirade (avancement auto) :
  // un <span display:block> (valide dans un <p>) dont le remplissage s'anime sur `ms`.
  function clearTimerBar(): void {
    opts.container.querySelectorAll('.line-timer').forEach((e) => e.remove());
  }
  function showTimerBar(el: HTMLElement, ms: number): void {
    clearTimerBar();
    const bar = document.createElement('span');
    bar.className = 'line-timer';
    const fill = document.createElement('span');
    fill.className = 'line-timer-fill';
    bar.appendChild(fill);
    el.insertBefore(bar, el.firstChild);
    void bar.offsetWidth; // force un reflow pour que la transition parte de 0
    fill.style.transition = `width ${ms}ms linear`;
    fill.style.width = '100%';
  }
  function cancelTimer(): void {
    if (timerId != null) {
      clearTimeout(timerId);
      timerId = null;
    }
    timed = false;
    timedMs = null;
    clearTimerBar();
  }
  function probeDuration(url: string): Promise<number> {
    return new Promise((resolve) => {
      const probe = document.createElement('audio');
      probe.preload = 'metadata';
      let settled = false;
      const done = (v: number): void => {
        if (settled) return;
        settled = true;
        probe.removeEventListener('loadedmetadata', onMeta);
        probe.removeEventListener('error', onErr);
        probe.src = '';
        resolve(v);
      };
      const onMeta = (): void => done(probe.duration);
      const onErr = (): void => done(NaN);
      probe.addEventListener('loadedmetadata', onMeta);
      probe.addEventListener('error', onErr);
      probe.src = url;
      setTimeout(() => done(NaN), 4000); // filet de sécurité si loadedmetadata ne vient jamais
    });
  }
  async function startTimedPause(t: AudioTirade, my: number): Promise<void> {
    let ms = estimateMs(t.text);
    let secs: number | null = null;
    try {
      secs = opts.resolveDuration ? await opts.resolveDuration(t) : null;
    } catch {
      /* on retombe sur l'estimation */
    }
    if (destroyed || my !== token) return;
    if (secs == null) {
      let url: string | null = null;
      try {
        url = await opts.resolveAudio(t);
      } catch {
        /* on garde l'estimation */
      }
      if (destroyed || my !== token) return;
      if (url) {
        const d = await probeDuration(url);
        if (destroyed || my !== token) return;
        secs = d;
      }
    }
    if (secs != null && Number.isFinite(secs) && secs > 0) ms = secs * 1000;
    timed = true;
    timedMs = ms;
    emit();
    showTimerBar(t.element, ms);
    timerId = setTimeout(() => {
      if (destroyed || my !== token) return;
      resolveCue();
    }, ms);
  }

  /** Entre en pause sur ma réplique (index i) : bip éventuel + minuteur si avancement auto. */
  function enterCuePause(i: number, my: number, beep: boolean): void {
    waitingForUser = true;
    cancelTimer();
    if (beep) playTick();
    if (settings.autoAdvance) {
      emit();
      void startTimedPause(tirades[i]!, my);
    } else {
      emit();
    }
  }

  /** Termine la pause courante : révèle ma réplique puis la joue (playMine) ou la saute. */
  function resolveCue(): void {
    const t = tirades[index];
    if (!t) return;
    cancelTimer();
    saidReveal(t.nodeId);
    playing = true;
    if (settings.playMine) void playIndex(index, true); // lit ma réplique, puis enchaîne
    else void playIndex(index + 1); // saute ma réplique
  }

  function stopAudio(): void {
    try {
      audio.pause();
    } catch {
      /* ignore */
    }
  }

  async function playIndex(i: number, resumingCue = false): Promise<void> {
    token++;
    const my = token;
    stopAudio();
    cancelTimer();
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

    // Répétition : pause avant ma réplique (sauf si on reprend cette même réplique).
    if (settings.rehearsal && isMine(t.characterId) && !resumingCue) {
      enterCuePause(i, my, true);
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
      // Pas d'audio (perso sans voix) : on enchaîne.
      if (playing) void playIndex(i + 1);
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
    // On saute le préfetch de MA réplique seulement si on n'en a pas besoin : ni jouée
    // (playMine) ni sondée pour sa durée (autoAdvance). En avancement auto, préfetcher
    // évite d'ajouter la latence réseau à la sonde de durée avant de lancer le minuteur.
    if (settings.rehearsal && isMine(t.characterId) && !settings.playMine && !settings.autoAdvance) return;
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
    token++; // invalide une éventuelle sonde de durée/résolution audio en vol
    playing = false;
    stopAudio();
    cancelTimer();
    emit();
  }

  /** Ré-applique masque + pause après un changement de réglages/rôles. */
  function reevaluate(): void {
    applyMask();
    const t = tirades[index];
    const stillMine = Boolean(t && settings.rehearsal && isMine(t.characterId));
    if (waitingForUser && !stillMine) {
      // La pause n'a plus lieu d'être (continu, ou ce n'est plus mon rôle) → on reprend.
      cancelTimer();
      waitingForUser = false;
      void playIndex(index);
    } else if (waitingForUser && stillMine) {
      // Toujours en pause sur ma réplique : on ré-établit la pause (nouveau masque/minuteur), sans re-biper.
      token++;
      enterCuePause(index, token, false);
    } else {
      cancelTimer();
      emit();
    }
  }

  applyMask();

  return {
    play,
    pause,
    toggle: () => (playing ? pause() : play()),
    next: () => {
      playing = true;
      cancelTimer();
      void playIndex(index + 1);
    },
    prev: () => {
      playing = true;
      cancelTimer();
      void playIndex(index - 1);
    },
    playFrom: (nodeId: string) => {
      const i = tirades.findIndex((t) => t.nodeId === nodeId);
      if (i < 0) return;
      playing = true;
      void playIndex(i);
    },
    resume: resolveCue,
    setSettings: (patch: Partial<ReadingSettings>) => {
      settings = { ...settings, ...patch };
      reevaluate();
    },
    setRoles: (cids: string[]) => {
      mineFn = rolesPredicate(cids);
      revealed.clear();
      reevaluate();
    },
    setRate: (r: number) => {
      rate = r;
      audio.playbackRate = r;
    },
    reveal: toggleReveal,
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
      applyMask();
      emit();
    },
    getState: snapshot,
    destroy: () => {
      destroyed = true;
      playing = false;
      cancelTimer();
      audio.removeEventListener('ended', onEnded);
      stopAudio();
      audio.src = '';
      clearHighlight();
      try {
        void audioCtx?.close(); // libère l'AudioContext du tic (ressource, surtout sur mobile)
      } catch {
        /* déjà fermé / indisponible */
      }
      audioCtx = null;
    },
  };
}
