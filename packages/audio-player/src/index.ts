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

import { createVoiceCoach, type SpeechRecognizer, type VoiceCoach, type VoiceStatus } from './voice';
import type { Tolerance } from '@theatre/voice-match';

export {
  createVoiceCoach,
  type SpeechRecognizer,
  type VoiceCoach,
  type VoicePhase,
  type VoiceStatus,
} from './voice';
// Ré-exporté ici pour que les hôtes (chrome du lecteur, app mobile) n'aient pas à
// dépendre de @theatre/voice-match juste pour nommer le niveau de tolérance.
export type { Evaluation, EvaluatedWord, Tolerance } from '@theatre/voice-match';

export interface AudioTirade {
  nodeId: string;
  characterId: string;
  element: HTMLElement;
  text: string;
}

/**
 * Répétition vocale (issue #40) : l'écoute remplace le geste de reprise sur mes
 * répliques. Optionnelle et injectée — le .html exporté et le lecteur web n'ont
 * pas de reconnaissance vocale et doivent continuer à se comporter comme avant.
 */
export interface VoiceOptions {
  recognizer: SpeechRecognizer;
  enabled?: boolean;
  tolerance?: Tolerance;
  locale?: string;
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
  /** N'afficher que les scènes où l'un de mes rôles joue (masque les autres). */
  onlyMyScenes: boolean;
}

const DEFAULT_SETTINGS: ReadingSettings = {
  rehearsal: false,
  mask: false,
  playMine: false,
  autoAdvance: false,
  tick: false,
  onlyMyScenes: false,
};

/**
 * Classe posée sur les éléments d'une scène masquée (option « mes scènes »).
 * Le lecteur mobile la pose sur les plages DOM exclues (pas de re-pagination) ;
 * `collectTirades` l'ignore pour que la lecture saute ces répliques. Le lecteur
 * web n'en a pas besoin : il re-rend une pièce filtrée, ces répliques sont absentes.
 */
export const HIDDEN_SCENE_CLASS = 'scene--hidden';

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
  /** Boucle sur la plage courante (cf. `setLoop`). */
  loop: boolean;
  /** Répétition vocale — `null` quand le mode est éteint ou indisponible. */
  voice: VoiceStatus | null;
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
  /** Source de durée optionnelle pour l'avancement auto (secondes) ; essayée avant la sonde. */
  resolveDuration?: (t: AudioTirade) => Promise<number | null>;
  /** Classe sur les répliques masquées. Défaut 'line--masked'. */
  maskedClass?: string;
  /** Classe ajoutée quand une réplique masquée est révélée. Défaut 'line--revealed'. */
  revealedClass?: string;
  /**
   * Plage (scène, acte, tête de pièce) d'une tirade — ce que `setLoop` rejoue.
   *
   * Le moteur ne voit qu'une liste plate : sans cette fonction il n'a aucun moyen
   * de savoir où une scène finit, et la boucle reste sans effet. L'hôte la dérive
   * du découpage de @theatre/core, qui reste seul propriétaire de la règle.
   */
  rangeOf?: (t: AudioTirade) => string | null;
  /** Répétition vocale. Absente = le lecteur se comporte exactement comme avant. */
  voice?: VoiceOptions;
}

export interface Player {
  play(): void;
  pause(): void;
  toggle(): void;
  next(): void;
  prev(): void;
  /** Joue une tirade précise (clic sur une réplique) : la position s'y place. */
  playFrom(nodeId: string): void;
  /**
   * Place la position sur une tirade sans rien jouer — le clic quand l'hôte n'a pas
   * d'audio. Sans lui, le masquage y serait figé : la position ne bougerait jamais,
   * or c'est elle qui décide de ce qui est flouté.
   */
  seek(nodeId: string): void;
  /** Résout une pause de répétition : joue ou saute ma réplique (selon playMine) ; révèle toujours. */
  resume(): void;
  /** Modifie les réglages (fusion partielle) ; re-masque et ré-évalue la position. */
  setSettings(patch: Partial<ReadingSettings>): void;
  /** Change mes rôles à la lecture ; re-masque et ré-évalue la position. */
  setRoles(characterIds: string[]): void;
  /**
   * Allume/éteint la répétition vocale, ou change sa tolérance. Éteindre pendant
   * une écoute la coupe net et laisse la pause ordinaire reprendre la main.
   * Sans `voice` dans les options, l'appel est sans effet.
   */
  setVoice(patch: { enabled?: boolean; tolerance?: Tolerance }): void;
  setRate(rate: number): void;
  /** Rejoue la plage courante au lieu d'enchaîner sur la suivante. Exige `rangeOf`. */
  setLoop(on: boolean): void;
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
    // Scène masquée (option « mes scènes ») : on ne l'indexe pas → lecture sautée.
    if (el.closest(`.${HIDDEN_SCENE_CLASS}`)) return;
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

/**
 * Où se replacer après un `refresh()` qui a reconstruit la liste des tirades.
 *
 * La tirade courante si elle a survécu — cas nominal (re-pagination Paged.js), la
 * position ne bouge pas d'un pouce. Sinon la première encore présente qui la SUIT
 * dans l'ordre du document : quand une plage vient d'être masquée, « la suite » est
 * ce que l'utilisateur attend, alors qu'un clamp numérique sur la liste rétrécie
 * atterrit à une position sans aucun rapport — typiquement au milieu d'un autre
 * acte. Rien devant (fin de pièce masquée) → la dernière qui la précède.
 */
function relocate(prev: AudioTirade[], prevIndex: number, next: AudioTirade[]): number {
  const at = new Map<string, number>();
  next.forEach((t, i) => at.set(t.nodeId, i));
  for (let k = prevIndex; k < prev.length; k++) {
    const i = at.get(prev[k]!.nodeId);
    if (i !== undefined) return i;
  }
  for (let k = Math.min(prevIndex, prev.length) - 1; k >= 0; k--) {
    const i = at.get(prev[k]!.nodeId);
    if (i !== undefined) return i;
  }
  return 0; // liste vide, ou plus rien de commun
}

export function createPlayer(opts: PlayerOptions): Player {
  const speakingClass = opts.speakingClass ?? 'line--speaking';
  const maskedClass = opts.maskedClass ?? 'line--masked';
  const revealedClass = opts.revealedClass ?? 'line--revealed';
  const audio = document.createElement('audio');
  audio.preload = 'auto';

  let tirades = collectTirades(opts.container);
  let index = 0;
  // Faux tant qu'aucune tirade n'a été atteinte DEPUIS la position courante. Sert
  // au premier ⏭/⏮ : à l'ouverture, ou après un `refresh()` qui a déplacé la
  // position, « suivant » doit JOUER là où on est plutôt que sauter la réplique —
  // sinon le premier appui manque la première réplique de la scène.
  let started = false;
  let playing = false;
  let waitingForUser = false;
  let settings: ReadingSettings = { ...DEFAULT_SETTINGS, ...opts.settings };
  let mineFn: (cid: string) => boolean =
    opts.isMine ?? (opts.roles ? rolesPredicate(opts.roles) : () => false);
  let rate = 1;
  let loop = false;
  // Enchaînements consécutifs sans qu'aucun clip n'ait démarré. Hors boucle, la fin
  // de liste borne la chaîne ; avec la boucle, une plage entièrement dépourvue d'audio
  // (export partiel, personnages sans voix) tournerait sans fin — et sans rien à
  // entendre pour s'en apercevoir. Voir le `!url` de `playIndex`.
  let silentSkips = 0;
  let destroyed = false;
  let token = 0; // invalide les résolutions asynchrones dépassées
  let highlighted: HTMLElement | null = null;
  let timerId: ReturnType<typeof setTimeout> | null = null;
  let timed = false;
  let timedMs: number | null = null;
  // Mes répliques masquées et leurs fragments (Paged.js peut couper une réplique sur
  // deux pages), dans l'ordre de lecture. Mémoïsé par `applyMask` pour que `syncMask`
  // n'ait plus qu'à basculer des classes : il tourne à chaque émission d'état, et
  // ré-interroger le DOM pour chaque réplique à ce rythme se sentirait sur mobile.
  let maskedLines: { at: number; els: HTMLElement[] }[] = [];
  let audioCtx: AudioContext | null = null;
  // Répétition vocale. `coach` n'existe que si l'hôte a fourni une reconnaissance ;
  // `voiceEnabled` est le réglage, qui bascule à chaud.
  let voiceEnabled = Boolean(opts.voice?.enabled);
  let voiceStatus: VoiceStatus | null = null;
  let coach: VoiceCoach | null = null;
  // Résout la promesse du clip de référence. Non nul = un clip joue POUR le coach,
  // et sa fin ne doit surtout pas faire avancer la lecture (cf. `onEnded`).
  let referenceDone: (() => void) | null = null;
  let warmId: ReturnType<typeof setTimeout> | null = null;

  function rolesPredicate(cids: string[]): (cid: string) => boolean {
    const set = new Set(cids);
    return (cid) => set.has(cid);
  }
  const isMine = (cid: string): boolean => mineFn(cid);
  const shouldMask = (): boolean => settings.rehearsal && settings.mask;
  /**
   * La répétition vocale ne vaut que dans le mode répétition : hors de lui, aucune
   * pause n'attend quoi que ce soit de moi, donc rien à écouter.
   */
  const voiceActive = (): boolean => Boolean(coach && voiceEnabled && settings.rehearsal);

  /**
   * Vitesse à appliquer à une tirade — `rate`, sauf sur MES répliques en répétition.
   *
   * L'accélération sert à traverser plus vite le texte des autres ; mes répliques,
   * elles, sont l'objet même de la répétition : c'est mon débit à moi qu'il s'agit de
   * caler, et l'accélérer me ferait travailler sur un rythme que je ne tiendrai pas
   * en scène. Vrai que la réplique soit muette (sautée, je la dis) ou jouée par le TTS
   * (`playMine`) : dans les deux cas la référence est le débit humain. Même raison
   * pour laquelle la pause de l'avancement automatique n'est pas raccourcie non plus.
   */
  const rateFor = (t: AudioTirade): number =>
    settings.rehearsal && isMine(t.characterId) ? 1 : rate;

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
      loop,
      voice: voiceActive() ? voiceStatus : null,
    };
  }
  function emit(): void {
    // Le flou est une fonction de la position, pas un état à tenir à jour à côté :
    // il se recalcule à chaque changement d'état plutôt que geste par geste.
    syncMask();
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

  // --- Masquage « répétition » ---------------------------------------------------
  //
  // UNE seule règle : la position de lecture partage la pièce en deux. Ce qui est
  // DERRIÈRE elle a été dit et s'affiche en clair ; ce qui est DEVANT reste flouté.
  // Rien n'est mémorisé — un registre de « déjà révélé » avait fini par demander une
  // purge par geste (clic, ⏮, boucle, tap), et chaque geste oublié était un bug.

  function fragmentsOf(nodeId: string): NodeListOf<HTMLElement> {
    const safe = nodeId.replace(/"/g, '\\"');
    return opts.container.querySelectorAll<HTMLElement>(`p.line[data-nid="${safe}"]`);
  }

  /**
   * Vrai quand la tirade de rang `at` est derrière la position : elle a été dite.
   *
   * La tirade COURANTE compte comme dite dès qu'on ne l'attend plus — c'est le cas de
   * `playMine`, où le TTS la lit sans qu'on bouge d'un rang. Tant que rien n'a été joué
   * (`started`), même la position 0 est devant nous : à l'ouverture, rien n'est en clair.
   */
  function isSaid(at: number): boolean {
    if (at < index) return true;
    return at === index && started && !waitingForUser;
  }

  /** Recense mes répliques et pose le masque. À rejouer quand la LISTE change. */
  function applyMask(): void {
    opts.container
      .querySelectorAll<HTMLElement>(`.${maskedClass}`)
      .forEach((el) => el.classList.remove(maskedClass, revealedClass));
    maskedLines = [];
    if (!shouldMask()) return;
    tirades.forEach((t, at) => {
      if (!isMine(t.characterId)) return;
      const els = Array.from(fragmentsOf(t.nodeId));
      els.forEach((el) => el.classList.add(maskedClass));
      maskedLines.push({ at, els });
    });
    syncMask();
  }

  /** Aligne le flou sur la position. À rejouer quand la POSITION change (cf. `emit`). */
  function syncMask(): void {
    for (const { at, els } of maskedLines) {
      const said = isSaid(at);
      for (const el of els) el.classList.toggle(revealedClass, said);
    }
  }

  // --- Signaux sonores (WebAudio, auto-contenus, marchent hors-ligne). ---
  //
  // Trois signaux, tous synthétisés : aucun fichier à embarquer, donc rien à
  // télécharger ni à manquer dans un export partiel. Le mode vocal doit pouvoir
  // s'utiliser sans regarder l'écran, c'est le son qui porte le verdict.
  interface Tone {
    hz: number;
    /** Décalage du début, en secondes, pour enchaîner deux notes. */
    at?: number;
    ms: number;
  }
  const TONES: Record<'cue' | 'reject' | 'borderline', Tone[]> = {
    // Le bip historique « c'est à toi », inchangé.
    cue: [{ hz: 880, ms: 150 }],
    // Deux notes descendantes, graves et brèves : identifiable sans être agressif,
    // et impossible à confondre avec le bip d'appel qui monte.
    reject: [
      { hz: 330, ms: 90 },
      { hz: 220, at: 0.1, ms: 110 },
    ],
    // Deux notes égales : « c'est passé, mais pas net ».
    borderline: [
      { hz: 660, ms: 80 },
      { hz: 660, at: 0.13, ms: 80 },
    ],
  };

  function playTones(kind: 'cue' | 'reject' | 'borderline'): void {
    try {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      audioCtx ??= new Ctor();
      if (audioCtx.state === 'suspended') void audioCtx.resume();
      const base = audioCtx.currentTime;
      for (const tone of TONES[kind]) {
        const t0 = base + (tone.at ?? 0);
        const secs = tone.ms / 1000;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.frequency.value = tone.hz;
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.2, t0 + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + secs);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(t0);
        osc.stop(t0 + secs + 0.01);
      }
    } catch {
      /* AudioContext indisponible : on ignore */
    }
  }

  /**
   * Le bip d'appel, sous condition du réglage — SAUF en répétition vocale, où il
   * annonce l'ouverture du micro. Le taire là reviendrait à écouter quelqu'un sans
   * le lui dire, et à attendre une réplique que personne ne sait devoir donner.
   */
  function playTick(): void {
    if (!settings.tick && !voiceActive()) return;
    playTones('cue');
  }

  /**
   * De combien le micro s'ouvre avant la fin de la réplique qui précède la mienne.
   *
   * Assez large pour couvrir l'installation du moteur ET un enchaînement rapide,
   * assez court pour que la voix captée de l'autre reste une queue de phrase, que
   * le coach retire par son préfixe.
   */
  const PRE_ARM_MS = 1000;

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

  /**
   * Annule TOUT ce qui attendait sur la pause en cours : minuteur, écoute du micro,
   * clip de référence.
   *
   * Remplace `cancelTimer()` partout où un geste quitte la pause. Un seul point
   * d'annulation, parce que le jour où un nouveau geste oubliera d'y passer, il
   * laissera le micro ouvert — et un micro oublié ne se voit pas.
   */
  function cancelPending(): void {
    cancelTimer();
    cancelWarmUp();
    coach?.cancel();
    if (referenceDone) {
      const done = referenceDone;
      referenceDone = null;
      stopAudio();
      done(); // le coach est déjà annulé : sa continuation verra sa génération périmée
    }
  }

  /**
   * Comme `cancelPending`, mais préserve un micro déjà ouvert en prévision de la
   * tirade qui arrive.
   *
   * C'est ce que doit appeler l'enchaînement d'une réplique à la suivante, par
   * opposition à un geste : couper là annulerait l'anticipation à chaque fois,
   * c'est-à-dire toujours, puisque tout enchaînement passe par `playIndex`.
   */
  function cancelInFlight(): void {
    cancelTimer();
    coach?.endEpisode();
    if (referenceDone) {
      const done = referenceDone;
      referenceDone = null;
      stopAudio();
      done();
    }
  }

  function cancelWarmUp(): void {
    if (warmId != null) {
      clearTimeout(warmId);
      warmId = null;
    }
  }

  /**
   * Programme l'ouverture du micro AVANT la fin de la réplique en cours, quand la
   * suivante est à moi.
   *
   * Mesuré en répétition : ouvrir le micro à la fin du clip laissait encore passer
   * des débuts de tirade, parce qu'on enchaîne sans attendre — la parole part avant
   * que le moteur ait fini de s'installer. Le micro capte donc la dernière seconde
   * de l'autre voix ; le coach la retire (cf. son `prefix`), et ce qui échapperait
   * à ce retrait tomberait de toute façon dans le départ libre de l'alignement.
   */
  function scheduleWarmUp(i: number, my: number): void {
    cancelWarmUp();
    if (!voiceActive()) return;
    const next = tirades[nextIndex(i)];
    if (!next || !isMine(next.characterId)) return;
    const arm = (): void => {
      if (destroyed || my !== token) return;
      const rate = audio.playbackRate || 1;
      const total =
        Number.isFinite(audio.duration) && audio.duration > 0
          ? (audio.duration * 1000) / rate
          : estimateMs(tirades[i]!.text);
      const left = total - (audio.currentTime * 1000) / rate;
      warmId = setTimeout(
        () => {
          if (destroyed || my !== token) return;
          coach?.warmUp();
        },
        Math.max(0, left - PRE_ARM_MS),
      );
    };
    // La durée n'est pas connue tant que les métadonnées ne sont pas là ; sur un
    // clip embarqué en data URI, c'est souvent immédiat.
    if (Number.isFinite(audio.duration) && audio.duration > 0) arm();
    else audio.addEventListener('loadedmetadata', arm, { once: true });
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
    // Volontairement PAS divisé par `rate` : cette pause vaut le temps qu'il faut à
    // un humain pour dire la réplique, et personne ne parle 1,5× plus vite parce que
    // les autres voix ont été accélérées. Cf. `rateFor`.
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
    cancelPending();
    // Répétition vocale : c'est le coach qui mène la pause de bout en bout — la
    // respiration, le bip, l'ouverture du micro, et sa fin. Le minuteur de
    // l'avancement automatique n'a plus de sens ici : il déciderait à la place de
    // l'écoute, et couperait quelqu'un au milieu de sa tirade.
    if (voiceActive()) {
      emit();
      coach!.begin(tirades[i]!.text);
      return;
    }
    if (beep) playTick();
    if (settings.autoAdvance) {
      emit();
      void startTimedPause(tirades[i]!, my);
    } else {
      emit();
    }
  }

  /**
   * Rejoue le clip de MA réplique sans bouger la position — le « modèle » que le
   * coach fait entendre après deux échecs.
   *
   * Ni `resolveCue` ni `playIndex` ne conviennent : tous deux avancent. C'est le
   * seul chemin qui joue puis rend la main exactement là où on était.
   */
  function playReference(): Promise<void> {
    const t = tirades[index];
    if (!t) return Promise.resolve();
    const my = token;
    return (async () => {
      let url: string | null = null;
      try {
        url = await opts.resolveAudio(t);
      } catch {
        /* pas de modèle disponible : le coach repart écouter */
      }
      if (destroyed || my !== token || !url) return;
      await new Promise<void>((resolve) => {
        referenceDone = resolve;
        audio.src = url;
        // Jamais accéléré : c'est le débit de référence qu'on vient réentendre,
        // pour la même raison que `rateFor` épargne mes répliques.
        audio.playbackRate = 1;
        const p = audio.play();
        if (p && typeof p.catch === 'function') {
          p.catch(() => {
            if (referenceDone !== resolve) return;
            referenceDone = null;
            resolve();
          });
        }
        // Filet : sans `ended` ni erreur (clip corrompu, WebView qui refuse), le
        // coach resterait suspendu et le micro ne se rouvrirait jamais.
        setTimeout(
          () => {
            if (referenceDone !== resolve) return;
            referenceDone = null;
            stopAudio();
            resolve();
          },
          Math.max(15000, estimateMs(t.text) * 2),
        );
      });
    })();
  }

  /**
   * Index de la tirade qui suit `from` dans un enchaînement automatique.
   *
   * Hors boucle, `from + 1`. Avec la boucle, atteindre le bout de la plage renvoie à
   * sa PREMIÈRE tirade. La plage est celle de la tirade qu'on vient de jouer, jamais
   * une plage figée à l'activation : après un ⏭ manuel qui change de scène, c'est la
   * nouvelle qui boucle — sinon le bouton mentirait sur « la scène en cours ».
   */
  function nextIndex(from: number): number {
    const rangeOf = opts.rangeOf;
    if (!loop || !rangeOf) return from + 1;
    const cur = tirades[from];
    if (!cur) return from + 1;
    const range = rangeOf(cur);
    if (range == null) return from + 1; // tirade hors découpage : on enchaîne
    const next = tirades[from + 1];
    if (next && rangeOf(next) === range) return from + 1;
    // Bout de la plage (ou de la pièce) : retour à sa première tirade.
    let start = from;
    while (start > 0 && rangeOf(tirades[start - 1]!) === range) start--;
    return start;
  }

  /**
   * Termine la pause courante : joue ma réplique (playMine) ou la saute.
   *
   * Dans les deux cas elle passe derrière la position — on ne l'attend plus si elle est
   * jouée, on est passé à la suivante si elle est sautée — donc elle se démasque d'elle-
   * même. Rien à révéler à la main.
   */
  function resolveCue(): void {
    const t = tirades[index];
    if (!t) return;
    cancelPending();
    playing = true;
    if (settings.playMine) void playIndex(index, true); // lit ma réplique, puis enchaîne
    else void playIndex(nextIndex(index)); // saute ma réplique
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
    cancelInFlight();
    if (i < 0 || i >= tirades.length) {
      playing = false;
      waitingForUser = false;
      clearHighlight();
      emit();
      return;
    }
    index = i;
    started = true;
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
      // Pas d'audio (perso sans voix) : on enchaîne. Le compteur est le seul garde-fou
      // de la boucle — voir sa déclaration.
      if (!playing) return;
      if (++silentSkips > tirades.length) {
        silentSkips = 0;
        playing = false;
        emit();
        return;
      }
      void playIndex(nextIndex(i));
      return;
    }

    silentSkips = 0;
    audio.src = url;
    audio.playbackRate = rateFor(t);
    const p = audio.play();
    if (p && typeof p.catch === 'function') {
      p.catch((e: unknown) => {
        if (destroyed || my !== token) return;
        opts.onError?.(e instanceof Error ? e.message : String(e));
      });
    }
    prefetch(nextIndex(i));
    scheduleWarmUp(i, my);
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
    if (destroyed) return;
    // Fin du clip de référence : il rend la main au coach et ne fait avancer RIEN.
    // Sans cette branche, réentendre le modèle sauterait la réplique qu'on est
    // justement en train d'apprendre.
    if (referenceDone) {
      const done = referenceDone;
      referenceDone = null;
      done();
      return;
    }
    if (!playing) return;
    void playIndex(nextIndex(index));
  }
  audio.addEventListener('ended', onEnded);

  if (opts.voice) {
    coach = createVoiceCoach({
      recognizer: opts.voice.recognizer,
      tolerance: opts.voice.tolerance ?? 'soft',
      locale: opts.voice.locale,
      playReference,
      // Volontairement PAS `resolveCue` : celui-ci rejouerait ma réplique quand
      // « Me faire répéter » est coché, alors que je viens de la dire — l'issue veut
      // qu'une tirade validée enchaîne, sans rien ajouter.
      advance: () => {
        cancelTimer();
        playing = true;
        void playIndex(nextIndex(index));
      },
      sound: (kind) => (kind === 'cue' ? playTick() : playTones(kind)),
      onState: (s) => {
        voiceStatus = s;
        emit();
      },
    });
  }

  function play(): void {
    if (playing) return;
    playing = true;
    // Prendre la route d'enregistrement AVANT le premier clip : cette bascule coupe
    // le son en cours, et c'est le seul instant où il n'y en a pas.
    if (voiceActive()) coach?.prepare();
    silentSkips = 0; // geste de l'utilisateur : la chaîne de sauts repart de zéro
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
    cancelPending();
    emit();
  }

  /** Ré-applique masque + pause après un changement de réglages/rôles. */
  function reevaluate(): void {
    applyMask();
    const t = tirades[index];
    // Basculer en répétition (ou s'attribuer un rôle) pendant une réplique qui joue
    // change sa vitesse de référence : sans ça, elle finirait accélérée.
    if (t) audio.playbackRate = rateFor(t);
    const stillMine = Boolean(t && settings.rehearsal && isMine(t.characterId));
    if (waitingForUser && !stillMine) {
      // La pause n'a plus lieu d'être (continu, ou ce n'est plus mon rôle) → on reprend.
      cancelPending();
      waitingForUser = false;
      void playIndex(index);
    } else if (waitingForUser && stillMine) {
      // Toujours en pause sur ma réplique : on ré-établit la pause (nouveau masque/minuteur), sans re-biper.
      token++;
      enterCuePause(index, token, false);
    } else {
      cancelPending();
      emit();
    }
  }

  applyMask();

  return {
    play,
    pause,
    toggle: () => (playing ? pause() : play()),
    // ⏭/⏮ ne passent PAS par `nextIndex` : un saut explicite doit pouvoir quitter la
    // plage, c'est le seul moyen d'aller répéter la scène d'à côté sans couper la boucle.
    next: () => {
      playing = true;
      silentSkips = 0;
      cancelPending();
      // ⏭ pendant ma pause vaut « je l'ai dite, on passe » : la position franchit ma
      // réplique, qui se démasque du même coup.
      void playIndex(started ? index + 1 : index);
    },
    prev: () => {
      playing = true;
      silentSkips = 0;
      cancelPending();
      // Borné à 0, et pas seulement pour éviter un arrêt en silence : sortir des bornes
      // laisse `index` sur place en levant `waitingForUser`, ce qui démasque la réplique
      // qu'on attendait — un ⏮ dirait « je l'ai dite » alors qu'il dit l'inverse.
      // Asymétrique avec ⏭ à la dernière tirade, et à raison : là, le geste veut bien
      // dire qu'on l'a dite.
      void playIndex(started ? Math.max(0, index - 1) : index);
    },
    playFrom: (nodeId: string) => {
      const i = tirades.findIndex((t) => t.nodeId === nodeId);
      if (i < 0) return;
      playing = true;
      silentSkips = 0;
      void playIndex(i);
    },
    seek: (nodeId: string) => {
      const i = tirades.findIndex((t) => t.nodeId === nodeId);
      if (i < 0) return;
      token++; // invalide résolution audio et sonde de durée en vol
      stopAudio();
      cancelPending();
      playing = false;
      waitingForUser = false;
      silentSkips = 0; // geste de l'utilisateur, comme play/next/prev/playFrom
      index = i;
      // Comme après un `refresh()` qui a déplacé la position : le prochain ⏭ doit
      // démarrer ICI, et la tirade visée reste devant nous, donc floutée.
      started = false;
      highlight(tirades[i]!.element);
      emit();
    },
    resume: resolveCue,
    setSettings: (patch: Partial<ReadingSettings>) => {
      settings = { ...settings, ...patch };
      reevaluate();
    },
    setRoles: (cids: string[]) => {
      mineFn = rolesPredicate(cids);
      reevaluate();
    },
    setVoice: (patch: { enabled?: boolean; tolerance?: Tolerance }) => {
      if (!coach) return;
      if (patch.tolerance) coach.setTolerance(patch.tolerance);
      if (patch.enabled === undefined || patch.enabled === voiceEnabled) return;
      voiceEnabled = patch.enabled;
      // Cocher le réglage est un geste : rien ne joue, c'est le bon moment pour
      // prendre la route audio sans que la bascule s'entende.
      if (voiceEnabled && settings.rehearsal) coach.prepare();
      if (!voiceEnabled) {
        // Éteindre coupe l'écoute SUR-LE-CHAMP, sans attendre la fin de la tirade.
        // La pause de répétition, elle, reste : on retombe simplement sur le geste
        // manuel, qui est l'état d'avant le mode vocal.
        //
        // `cancelPending()` et non `coach.cancel()` : éteindre pendant la lecture du
        // modèle laissait le clip aller jusqu'au bout, alors que l'écran venait
        // d'annoncer que le mode était coupé.
        cancelPending();
        // Et on rend la route audio : la garder en qualité d'enregistrement après
        // avoir éteint le mode dégraderait toute la lecture qui suit.
        coach.releaseRoute();
        voiceStatus = null;
        emit();
        return;
      }
      // Allumé pendant une pause déjà en cours : la boucle démarre tout de suite,
      // sinon il faudrait passer une réplique pour que le réglage prenne effet.
      if (waitingForUser && voiceActive()) {
        token++;
        enterCuePause(index, token, false);
      } else {
        emit();
      }
    },
    setRate: (r: number) => {
      // Zéro fige la lecture sans rien pour l'expliquer, et une valeur négative fait
      // lever `playbackRate` : on refuse plutôt que d'entrer dans cet état.
      if (!Number.isFinite(r) || r <= 0) return;
      rate = r;
      // Par `rateFor` et non `r` : changer la vitesse pendant MA réplique ne doit pas
      // l'accélérer d'un coup au milieu.
      const t = tirades[index];
      audio.playbackRate = t ? rateFor(t) : r;
    },
    setLoop: (on: boolean) => {
      // Sans `rangeOf`, le moteur ne sait pas où finit une plage : accepter l'état
      // allumerait un bouton qui ne boucle rien, et `getState().loop` mentirait à
      // l'hôte. Refuser laisse au moins le désaccord visible du bon côté.
      loop = on && Boolean(opts.rangeOf);
      emit();
    },
    refresh: () => {
      const prev = tirades;
      const prevId = prev[index]?.nodeId ?? null;
      tirades = collectTirades(opts.container);
      index = relocate(prev, index, tirades);
      const nextId = tirades[index]?.nodeId ?? null;
      // Avant toute relance : la liste vient de changer, et `syncMask` (appelé par
      // chaque `emit`) travaille sur les éléments recensés ici.
      applyMask();

      // Comparaison SANS garde sur `prevId` : le passage d'une liste vide à une
      // liste peuplée est un déplacement, au même titre que l'inverse. Exiger
      // `prevId !== null` laissait `started` à vrai quand le filtre avait tout
      // masqué puis qu'on le relâchait — le ⏭ suivant sautait de nouveau la
      // première réplique redevenue visible.
      if (prevId !== nextId) {
        // La tirade courante vient d'être masquée. On coupe NET : laisser le clip
        // finir ferait entendre précisément ce qu'on vient de masquer. `token++`
        // invalide aussi les résolutions audio et sondes de durée encore en vol.
        token++;
        stopAudio();
        cancelPending();
        if (playing || waitingForUser) void playIndex(index);
        // À l'arrêt : le prochain ⏭ doit démarrer ICI, pas un cran plus loin.
        else started = false;
      } else if (playing || waitingForUser) {
        // Ré-accroche la surbrillance à l'élément (re-paginé) courant.
        const t = tirades[index];
        if (t) highlight(t.element);
      }
      emit();
    },
    getState: snapshot,
    destroy: () => {
      destroyed = true;
      playing = false;
      cancelPending();
      coach?.destroy();
      coach = null;
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
