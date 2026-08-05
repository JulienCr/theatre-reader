/**
 * Boucle de répétition vocale : écouter la réplique, la juger, la faire refaire.
 *
 * Le moteur de lecture sait déjà s'arrêter sur mes répliques (`enterCuePause`) ;
 * ce module prend la main pendant cette pause et ne la rend qu'une fois la tirade
 * acquise. Il ne touche ni au DOM, ni au micro, ni à l'audio : la reconnaissance
 * arrive par `SpeechRecognizer` (natif iOS dans l'app, factice en développement) et
 * la lecture du clip de référence par un rappel du lecteur. C'est ce qui le rend
 * jouable en test avec de fausses transcriptions, sans téléphone.
 *
 * Rien n'est conservé : la transcription est effacée dès l'évaluation, et il ne
 * reste à l'écran que les quelques mots des écarts.
 */
import { evaluate, type Evaluation, type Tolerance } from '@theatre/voice-match';

/**
 * Ce que l'hôte doit fournir pour écouter. Les événements sont poussés (et non
 * attendus) parce qu'une transcription arrive par bouffées : la validation
 * anticipée de l'issue exige de juger chaque résultat partiel, pas seulement le
 * dernier.
 */
export interface SpeechRecognizer {
  /** Moteur présent ET permissions accordées. Faux = pas de mode vocal, sans erreur. */
  available(): Promise<boolean>;
  start(opts: { locale: string }): Promise<void>;
  /** Fin propre : le moteur peut encore émettre son dernier résultat. */
  stop(): Promise<void>;
  /** Coupure immédiate : plus rien ne doit remonter. */
  abort(): Promise<void>;
  /**
   * Prend la route audio d'enregistrement sans ouvrir le micro, si le moteur en a
   * besoin. À appeler quand RIEN ne joue.
   *
   * Sur iOS, basculer la session en `.playAndRecord` coupe net ce que la WebView
   * joue. Tant que cette bascule tombait entre deux clips, elle ne s'entendait pas ;
   * ouvrir le micro à l'avance l'a mise en plein milieu d'une réplique. La faire
   * d'avance, au calme, est ce qui rend l'anticipation silencieuse.
   */
  prepare?(): Promise<void>;
  /** Rend la route audio à la lecture. Appelé quand le mode vocal s'arrête. */
  release?(): Promise<void>;
  onPartial(cb: (text: string) => void): () => void;
  onFinal(cb: (text: string) => void): () => void;
  onError(cb: (message: string) => void): () => void;
}

export type VoicePhase =
  /** Hors boucle : rien n'est attendu, le micro est fermé. */
  | 'idle'
  /** La respiration avant le signal : c'est bientôt à moi. */
  | 'waiting'
  | 'listening'
  | 'validated'
  | 'borderline'
  | 'failed'
  | 'no-speech'
  /** Lecture du clip de référence, après deux échecs. */
  | 'reference'
  | 'error';

export interface VoiceStatus {
  phase: VoicePhase;
  /** Transcription en cours. Vidée dès qu'un verdict est rendu. */
  heard: string;
  /** Écarts du dernier verdict, prêts à afficher. Survit à la fin de la boucle. */
  result: Evaluation | null;
  /** Échecs consécutifs sur la tirade courante. */
  failures: number;
  /** Message court à l'écran (erreur, ou invitation à reprendre la main). */
  message: string | null;
}

export interface VoiceCoachOptions {
  recognizer: SpeechRecognizer;
  tolerance: Tolerance;
  locale?: string;
  /** Joue le clip de la tirade courante et résout à la fin — ou tout de suite s'il n'y en a pas. */
  playReference: () => Promise<void>;
  /** La tirade est acquise : au lecteur d'enchaîner. */
  advance: () => void;
  sound: (kind: 'cue' | 'reject' | 'borderline') => void;
  onState: (s: VoiceStatus) => void;
}

export interface VoiceCoach {
  /**
   * Ouvre le micro à l'avance, avant même que ce soit mon tour.
   *
   * Le lecteur l'appelle pendant la réplique précédente. Rien n'est annoncé et
   * rien n'est évalué : c'est la chauffe du moteur (session audio, AVAudioEngine)
   * qu'on veut payer d'avance. Ce qu'il capte de l'autre voix est mémorisé pour
   * être retiré au moment où la parole me revient.
   */
  warmUp(): void;
  /**
   * Prépare la route audio, à un moment où rien ne joue (démarrage de la lecture,
   * activation du réglage). Sans elle, la première ouverture du micro couperait le
   * clip en cours.
   */
  prepare(): void;
  /** Rend la route audio à la lecture pleine qualité (le mode vocal s'arrête). */
  releaseRoute(): void;
  /** Prend la main sur la pause : respiration, signal, écoute. */
  begin(expectedText: string): void;
  /** Rend la main immédiatement (geste de l'utilisateur, réglage, sortie). */
  cancel(): void;
  /**
   * Clôt l'épisode en cours sans casser une chauffe en préparation.
   *
   * Ce qu'appelle l'enchaînement automatique d'une tirade à la suivante, là où
   * `cancel()` répond à un geste — et doit, lui, fermer le micro.
   */
  endEpisode(): void;
  setTolerance(t: Tolerance): void;
  destroy(): void;
}

/**
 * Respiration entre la fin de la réplique précédente et le signal.
 *
 * L'issue la demande « confortable » : sans elle, le bip tombe sur la dernière
 * syllabe de l'autre personnage et on se met à parler avant d'avoir compris que
 * c'était à soi.
 */
const BREATH_MS = 700;

/** Silence qui clôt une tentative, faute de validation anticipée (issue : ~800 ms). */
const SILENCE_MS = 800;

/** Sans un seul mot pendant ce temps, la tentative est « aucune parole », pas une erreur. */
const NO_SPEECH_MS = 6000;

/** Temps laissé au son de refus et aux écarts avant de rouvrir le micro. */
const FEEDBACK_MS = 900;

/** Idem pour une validation limite, plus court : on enchaîne, le son doit juste passer. */
const BORDERLINE_MS = 500;

/** Échecs consécutifs après lesquels le clip de référence est joué (issue : exactement 2). */
const MAX_FAILURES = 2;

/** Tentatives muettes après lesquelles on rend la main plutôt que de tourner micro ouvert. */
const MAX_SILENT = 2;

export function createVoiceCoach(o: VoiceCoachOptions): VoiceCoach {
  // Une génération par épisode. Tout ce qui est en vol (minuteurs, lecture du clip,
  // démarrage du micro) la teste avant d'agir : c'est le seul moyen sûr qu'un
  // `cancel()` — désactivation du mode, ⏭, changement de scène — ne laisse pas une
  // continuation rallumer le micro une seconde plus tard.
  let gen = 0;
  let destroyed = false;
  let tolerance = o.tolerance;

  let phase: VoicePhase = 'idle';
  let heard = '';
  let result: Evaluation | null = null;
  let failures = 0;
  let silent = 0;
  let expected = '';
  let message: string | null = null;

  let listening = false;
  /** Le micro tourne, mais ce n'est pas encore à moi : on n'évalue rien. */
  let warm = false;
  /**
   * Ce que le moteur avait déjà transcrit quand la parole m'est revenue — la fin
   * de la réplique précédente, captée pendant la chauffe. Les résultats suivants
   * arrivent complets depuis le début de la session : sans ce retrait, la voix de
   * l'autre compterait comme mon amorce et mangerait le budget d'autocorrection.
   */
  let prefix = '';
  let timers: ReturnType<typeof setTimeout>[] = [];
  let idleId: ReturnType<typeof setTimeout> | null = null;
  /**
   * Autorisation obtenue — et elle seule est mémorisée (cf. `openMic`).
   *
   * C'est `available()` qui déclenche la demande système côté iOS : ne jamais
   * l'appeler revient à ouvrir le micro sans l'avoir obtenu, et `start()` échoue
   * alors sans que personne n'ait vu passer la moindre demande.
   */
  let authorized = false;

  function emit(): void {
    o.onState({ phase, heard, result, failures, message });
  }

  function at(ms: number, fn: () => void): void {
    const my = gen;
    timers.push(
      setTimeout(() => {
        if (destroyed || my !== gen) return;
        fn();
      }, ms),
    );
  }

  function clearTimers(): void {
    timers.forEach(clearTimeout);
    timers = [];
    if (idleId != null) {
      clearTimeout(idleId);
      idleId = null;
    }
  }

  /**
   * (Ré)arme le minuteur d'inactivité.
   *
   * Un seul minuteur pour deux rôles, parce que c'est la même question posée à deux
   * moments : tant que rien n'a été dit, on attend longtemps qu'on se lance ; dès
   * qu'un mot est tombé, un court silence signe la fin de la tirade.
   */
  function armIdle(): void {
    if (idleId != null) clearTimeout(idleId);
    const my = gen;
    const spoken = heard.length > 0;
    idleId = setTimeout(
      () => {
        if (destroyed || my !== gen) return;
        if (spoken) finish();
        else noSpeech();
      },
      spoken ? SILENCE_MS : NO_SPEECH_MS,
    );
  }

  function stopListening(hard: boolean): void {
    if (!listening) return;
    listening = false;
    warm = false;
    prefix = '';
    if (idleId != null) {
      clearTimeout(idleId);
      idleId = null;
    }
    void (hard ? o.recognizer.abort() : o.recognizer.stop()).catch(() => {
      /* le micro était déjà fermé : rien à réparer */
    });
  }

  /**
   * Ouvre le micro tout de suite, et n'annonce l'écoute qu'au bout de `delay`.
   *
   * L'ordre est le point important, et il vient d'une mesure en répétition : le
   * début des répliques se perdait presque à chaque fois. Ouvrir le micro APRÈS le
   * signal additionnait deux retards — l'attente elle-même, puis le temps qu'iOS
   * bascule la session en `playAndRecord` et démarre `AVAudioEngine`. Or c'est le
   * signal qui donne le départ : on parlait donc exactement pendant que le moteur
   * s'installait.
   *
   * Démarrer d'abord fait payer cette chauffe pendant la respiration, où personne
   * n'attend rien. Le micro capte alors le signal sonore, sans conséquence : un son
   * pur ne produit pas de mots, et le départ libre de l'alignement absorberait de
   * toute façon une amorce parasite.
   *
   * `delay` court depuis l'APPEL, pas depuis le démarrage effectif : le signal doit
   * tomber à la même seconde quelle que soit la lenteur du moteur ce jour-là.
   */
  /** Ouvre le micro s'il ne l'est pas déjà. Rend faux si l'autorisation manque. */
  async function openMic(my: number): Promise<boolean> {
    if (listening) return true; // déjà chaud : c'est tout l'objet de `warmUp`

    if (!authorized) {
      // Seul un OUI se retient. Mémoriser un refus enfermerait le mode dans son
      // erreur : accorder le micro dans les Réglages puis revenir ne changerait
      // rien avant un redémarrage du lecteur. Redemander ne coûte rien — iOS ne
      // réaffiche pas sa demande une fois la réponse donnée.
      try {
        authorized = await o.recognizer.available();
      } catch {
        authorized = false;
      }
      if (destroyed || my !== gen) return false;
    }
    if (!authorized) {
      phase = 'error';
      message = 'Micro non autorisé. Autorise-le dans Réglages, puis relance la lecture.';
      emit();
      return false;
    }

    try {
      await o.recognizer.start({ locale: o.locale ?? 'fr-FR' });
    } catch (e) {
      if (destroyed || my !== gen) return false;
      phase = 'error';
      message = e instanceof Error ? e.message : String(e);
      emit();
      return false;
    }
    // Annulé pendant le démarrage : le micro vient de s'ouvrir pour personne.
    if (destroyed || my !== gen) {
      void o.recognizer.abort().catch(() => {});
      return false;
    }
    listening = true;
    prefix = '';
    return true;
  }

  async function listen(delay: number, cue: boolean): Promise<void> {
    const my = gen;
    const dueAt = Date.now() + delay;
    heard = '';
    message = null;
    emit();

    if (!(await openMic(my))) return;
    if (destroyed || my !== gen) return;

    // Le micro est chaud. L'écoute ne « commence » — signal, affichage, minuteur —
    // qu'une fois la respiration écoulée. Ce qui serait dit avant est capté quand
    // même : quelqu'un qui part en avance ne perd plus son début.
    at(Math.max(0, dueAt - Date.now()), () => {
      if (cue) o.sound('cue');
      phase = 'listening';
      emit();
      armIdle();
    });
  }

  function onPartial(text: string): void {
    if (!listening) return;
    const t = text.trim();
    if (!t) return;
    // Chauffe : c'est encore l'autre qui parle. On retient sa transcription pour la
    // retirer ensuite, sans rien évaluer.
    if (warm) {
      prefix = t;
      return;
    }
    // Le moteur rend toujours l'énoncé complet depuis l'ouverture du micro : ce qui
    // vient de la réplique précédente se retire par la tête. Si le moteur a révisé
    // son texte au point que le préfixe ne colle plus, on garde tout — l'amorce
    // parasite tombera dans le départ libre de l'alignement.
    const mine = prefix && t.startsWith(prefix) ? t.slice(prefix.length).trim() : t;
    if (!mine) return;
    heard = mine;
    armIdle();
    emit();
    // Validation anticipée : la tirade est complète, inutile d'attendre le silence.
    // Seul un `ok` déclenche — un `borderline` sur un résultat partiel dirait
    // « tu as ajouté des mots » alors que la phrase n'est pas finie.
    //
    // Sur `mine` et non sur `t` : juger la transcription complète y laisserait la
    // fin de la réplique précédente, c'est-à-dire exactement ce que le préfixe vient
    // de retirer. Au-delà de quelques mots, elle épuise le départ libre de
    // l'alignement et empêche la validation anticipée — au moment même où la chauffe
    // sert à quelque chose.
    const r = evaluate(expected, mine, { tolerance });
    if (r.verdict === 'ok') conclude(r);
  }

  function onFinal(text: string): void {
    if (!listening) return;
    const t = text.trim();
    if (warm) {
      prefix = t;
      return;
    }
    const mine = prefix && t.startsWith(prefix) ? t.slice(prefix.length).trim() : t;
    if (mine) heard = mine;
    finish();
  }

  function finish(): void {
    if (!listening) return;
    stopListening(false);
    if (!heard) {
      noSpeech();
      return;
    }
    conclude(evaluate(expected, heard, { tolerance }));
  }

  function conclude(r: Evaluation): void {
    stopListening(false);
    if (r.verdict === 'no-speech') {
      noSpeech();
      return;
    }
    // Quelque chose a été dit : la série de tentatives muettes est rompue, même si
    // la réplique est fausse. Sans cette remise à zéro, « silence, erreur, silence »
    // rendait la main comme si personne n'avait ouvert la bouche.
    silent = 0;
    // La transcription a joué son rôle : elle disparaît ici, et seuls les écarts
    // (quelques mots) restent affichables.
    heard = '';
    // Une tirade juste n'a pas d'écart à montrer. Garder son résultat laisserait la
    // réplique validée affichée sous la barre pendant toute la scène suivante — du
    // bruit permanent, là où l'affichage ne sert qu'à expliquer un refus.
    result = r.verdict === 'ok' ? null : r;

    if (r.verdict === 'ok') {
      failures = 0;
      silent = 0;
      phase = 'validated';
      emit();
      // Aucun son de succès : l'issue veut qu'on enchaîne, point.
      o.advance();
      return;
    }
    if (r.verdict === 'borderline') {
      failures = 0;
      silent = 0;
      phase = 'borderline';
      emit();
      o.sound('borderline');
      at(BORDERLINE_MS, () => o.advance());
      return;
    }

    failures++;
    phase = 'failed';
    emit();
    o.sound('reject');
    // Le micro se rouvre pendant que le son de refus joue et que les écarts
    // s'affichent : la nouvelle tentative n'attend pas que le moteur redémarre.
    if (failures >= MAX_FAILURES) at(FEEDBACK_MS, () => void reference());
    else void listen(FEEDBACK_MS, false);
  }

  /**
   * Rien d'exploitable n'a été dit.
   *
   * Ne compte PAS comme un échec : il n'y a pas d'erreur de texte, et la faire
   * suivre du clip de référence punirait quelqu'un qui s'est simplement interrompu.
   * Après deux tentatives muettes on rend la main : mieux vaut un lecteur en pause
   * qu'un micro ouvert sur une pièce vide.
   */
  function noSpeech(): void {
    stopListening(false);
    silent++;
    result = null;
    heard = '';
    phase = 'no-speech';
    if (silent >= MAX_SILENT) {
      message = 'Rien entendu. Reprends quand tu veux.';
      emit();
      gen++; // coupe tout ce qui était en vol : on attend un geste, plus rien d'autre
      clearTimers();
      return;
    }
    message = null;
    emit();
    void listen(FEEDBACK_MS, false);
  }

  async function reference(): Promise<void> {
    const my = gen;
    stopListening(true); // le micro ne doit rien entendre du clip
    phase = 'reference';
    emit();
    try {
      await o.playReference();
    } catch {
      /* pas de clip, ou lecture refusée : on repart écouter quand même */
    }
    if (destroyed || my !== gen) return;
    // Le compteur repart de zéro après CHAQUE référence : le cycle « deux erreurs,
    // puis on réécoute le modèle » se répète à l'identique jusqu'à validation.
    failures = 0;
    // Même respiration et même signal qu'à la première fois : après avoir écouté le
    // modèle, on redémarre une tentative, pas la fin d'une autre.
    void listen(BREATH_MS, true);
  }

  /** Coupe tout, micro compris. Ce qu'appelle un geste de l'utilisateur. */
  function cancelAll(): void {
    gen++;
    clearTimers();
    stopListening(true);
    phase = 'idle';
    heard = '';
    message = null;
    // `result` est délibérément conservé : après une validation limite, les écarts
    // doivent rester lisibles pendant que la lecture continue.
    emit();
  }

  const off = [
    o.recognizer.onPartial(onPartial),
    o.recognizer.onFinal(onFinal),
    o.recognizer.onError((msg) => {
      if (!listening) return;
      // `gen++` et le nettoyage AVANT de poser l'état : une erreur pendant la
      // respiration laisse derrière elle le minuteur qui joue le signal et arme
      // l'écoute. Sans cette invalidation, il tire quand même, relance la boucle
      // et contredit l'erreur qu'on vient d'afficher.
      gen++;
      clearTimers();
      stopListening(true);
      phase = 'error';
      message = msg;
      emit();
    }),
  ];

  return {
    prepare() {
      if (destroyed) return;
      void o.recognizer.prepare?.().catch(() => {
        /* route indisponible : l'ouverture du micro s'en chargera */
      });
    },
    releaseRoute() {
      void o.recognizer.release?.().catch(() => {});
    },
    warmUp() {
      if (destroyed || listening) return;
      warm = true;
      prefix = '';
      void openMic(gen).then((ok) => {
        if (!ok) warm = false;
      });
    },
    begin(text: string) {
      gen++;
      clearTimers();
      // Le micro déjà ouvert par la chauffe est CONSERVÉ : le rouvrir ici
      // rendrait l'anticipation inutile, puisqu'on repaierait le démarrage
      // exactement au moment où la parole revient.
      if (!warm) stopListening(true);
      warm = false; // à partir d'ici, ce qui est dit compte
      expected = text;
      failures = 0;
      silent = 0;
      result = null;
      heard = '';
      message = null;
      phase = 'waiting';
      emit();
      void listen(BREATH_MS, true);
    },
    endEpisode() {
      // Une chauffe en cours prépare la tirade qui arrive : la couper ici annulerait
      // l'anticipation à chaque enchaînement, c'est-à-dire toujours.
      if (!warm) {
        cancelAll();
        return;
      }
      gen++;
      clearTimers();
      phase = 'idle';
      heard = '';
      message = null;
      emit();
    },
    cancel: cancelAll,
    setTolerance(t: Tolerance) {
      tolerance = t;
    },
    destroy() {
      destroyed = true;
      gen++;
      clearTimers();
      stopListening(true);
      // Rend la route audio : sans ça, la lecture resterait en qualité
      // d'enregistrement après la sortie du mode.
      void o.recognizer.release?.().catch(() => {});
      off.forEach((fn) => fn());
    },
  };
}
