// @vitest-environment happy-dom
/**
 * La boucle de répétition vocale, éprouvée de bout en bout à travers le lecteur —
 * pas seulement le coach isolé : ce sont les points de couture (pause, clip de
 * référence, gestes de l'utilisateur) qui peuvent laisser un micro ouvert.
 *
 * La reconnaissance est un objet de test : on lui dicte ce qui a été « entendu »,
 * ce qui rend toute la boucle jouable sans téléphone, sans micro et sans réseau.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPlayer, type PlayerOptions, type PlayerState, type SpeechRecognizer } from './index';

function fakeRecognizer() {
  const partials: ((t: string) => void)[] = [];
  const finals: ((t: string) => void)[] = [];
  const errors: ((t: string) => void)[] = [];
  let live = false;
  let starts = 0;
  // `indexOf` rend -1 quand le rappel n'est plus là (double désabonnement), et
  // `splice(-1, 1)` retire alors le DERNIER — un désabonnement qui débranche
  // quelqu'un d'autre, ce qui se lit ensuite comme un moteur devenu muet.
  const drop = <T>(list: T[], item: T) => (): void => {
    const i = list.indexOf(item);
    if (i >= 0) list.splice(i, 1);
  };
  const api: SpeechRecognizer = {
    available: () => Promise.resolve(true),
    start: () => {
      starts++;
      live = true;
      return Promise.resolve();
    },
    stop: () => {
      live = false;
      return Promise.resolve();
    },
    abort: () => {
      live = false;
      return Promise.resolve();
    },
    onPartial: (cb) => {
      partials.push(cb);
      return drop(partials, cb);
    },
    onFinal: (cb) => {
      finals.push(cb);
      return drop(finals, cb);
    },
    onError: (cb) => {
      errors.push(cb);
      return drop(errors, cb);
    },
  };
  return {
    api,
    say: (t: string) => partials.slice().forEach((cb) => cb(t)),
    finalize: (t: string) => finals.slice().forEach((cb) => cb(t)),
    fail: (m: string) => errors.slice().forEach((cb) => cb(m)),
    get live() {
      return live;
    },
    get starts() {
      return starts;
    },
  };
}

/** Laisse passer les promesses en vol sans faire avancer l'horloge simulée. */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

/** Avance l'horloge ET vide la file de microtâches — le coach enchaîne les deux. */
const tick = async (ms: number): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms);
  await flush();
};

/** Respiration : le temps au bout duquel l'écoute est annoncée (le micro, lui, est déjà ouvert). */
const TO_MIC = 700 + 10;

describe('@theatre/audio-player — répétition vocale', () => {
  let container: HTMLElement;
  let last: PlayerState | null;
  let audios: HTMLAudioElement[];
  let rec: ReturnType<typeof fakeRecognizer>;

  const TEXT = 'Je ne reviendrai jamais dans cette maison.';

  beforeEach(() => {
    vi.useFakeTimers();
    HTMLMediaElement.prototype.play = () => Promise.resolve();
    HTMLMediaElement.prototype.pause = () => {};
    document.body.innerHTML =
      '<div id="c">' +
      '<p class="line" data-cid="benji" data-nid="b#0"><span class="speech">Tu pars ?</span></p>' +
      `<p class="line" data-cid="moi" data-nid="m#0"><span class="speech">${TEXT}</span></p>` +
      '<p class="line" data-cid="benji" data-nid="b#1"><span class="speech">Bon.</span></p>' +
      '</div>';
    container = document.getElementById('c') as HTMLElement;
    last = null;
    audios = [];
    rec = fakeRecognizer();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const build = (extra: Partial<PlayerOptions> = {}, voiceEnabled = true) => {
    const real = document.createElement.bind(document);
    document.createElement = ((tag: string) => {
      const el = real(tag);
      if (tag === 'audio') audios.push(el as HTMLAudioElement);
      return el;
    }) as typeof document.createElement;
    try {
      return createPlayer({
        container,
        resolveAudio: (t) => Promise.resolve(`blob:${t.nodeId}`),
        roles: ['moi'],
        settings: { rehearsal: true },
        onState: (s) => {
          last = s;
        },
        voice: { recognizer: rec.api, enabled: voiceEnabled },
        ...extra,
      });
    } finally {
      document.createElement = real;
    }
  };

  /** Amène la lecture jusqu'à la pause sur MA réplique, micro ouvert. */
  const upToMic = async (p: ReturnType<typeof build>): Promise<void> => {
    p.play();
    await flush();
    audios[0]!.dispatchEvent(new Event('ended')); // fin de la réplique de l'autre
    await flush();
    await tick(TO_MIC);
  };

  it("n'ouvre le micro que sur mes répliques", async () => {
    const p = build();
    p.play();
    await flush();
    // On est sur la réplique de l'autre : rien ne doit écouter.
    await tick(TO_MIC);
    expect(rec.live).toBe(false);
    p.destroy();
  });

  // Le micro s'ouvre AVANT le signal, et c'est tout l'intérêt : la chauffe du
  // moteur (session audio, AVAudioEngine) se paie pendant la respiration, au lieu
  // de manger le début de la réplique. Mesuré en répétition avant ce changement :
  // le début se perdait presque à chaque fois.
  it('ouvre le micro dès la respiration, et n’annonce l’écoute qu’au signal', async () => {
    const p = build();
    p.play();
    await flush();
    audios[0]!.dispatchEvent(new Event('ended'));
    await flush();
    expect(rec.live).toBe(true); // déjà chaud
    expect(last?.voice?.phase).toBe('waiting'); // mais on n'attend pas encore la réplique
    await tick(TO_MIC);
    expect(last?.voice?.phase).toBe('listening');
    p.destroy();
  });

  it('capte une réplique commencée avant le signal', async () => {
    const p = build();
    p.play();
    await flush();
    audios[0]!.dispatchEvent(new Event('ended'));
    await flush();
    await tick(200); // en plein dans la respiration
    rec.say(TEXT.toLowerCase());
    await flush();
    expect(last?.currentNodeId).toBe('b#1'); // validée, rien n'est perdu
    p.destroy();
  });

  // Le micro s'ouvre AVANT la fin de la réplique précédente : on enchaîne sans
  // attendre, et la parole part avant que le moteur ait fini de s'installer.
  it('ouvre le micro avant la fin de la réplique précédente', async () => {
    const p = build();
    p.play();
    await flush();
    // happy-dom ne simule pas la lecture : on pose la durée et la position à la main.
    Object.defineProperty(audios[0]!, 'duration', { value: 5, configurable: true });
    audios[0]!.dispatchEvent(new Event('loadedmetadata'));
    await flush();
    expect(rec.live).toBe(false);
    await tick(4100); // 4,1 s sur 5 : il reste moins que le pré-armement
    expect(rec.live).toBe(true);
    // Rien n'est annoncé — ce n'est pas encore à moi, et l'écran ne montre donc rien
    // (`VoiceFeedback` ne rend rien sur `idle` sans écart à afficher).
    expect(last?.voice?.phase).toBe('idle');
    p.destroy();
  });

  // La bascule de route audio coupe net ce que la WebView joue. Elle doit donc
  // arriver quand rien ne joue — et une seule fois, pas à chaque tirade.
  it('prend la route audio avant le premier clip, et la rend en sortant du mode', async () => {
    const calls: string[] = [];
    const traced = {
      ...rec.api,
      prepare: () => (calls.push('prepare'), Promise.resolve()),
      release: () => (calls.push('release'), Promise.resolve()),
    };
    const p = build({ voice: { recognizer: traced, enabled: true } });
    p.play();
    await flush();
    expect(calls).toEqual(['prepare']);

    Object.defineProperty(audios[0]!, 'duration', { value: 5, configurable: true });
    audios[0]!.dispatchEvent(new Event('loadedmetadata'));
    await flush();
    await tick(4100); // le micro s'ouvre : aucune bascule supplémentaire
    audios[0]!.dispatchEvent(new Event('ended'));
    await flush();
    await tick(TO_MIC);
    expect(calls).toEqual(['prepare']);

    p.setVoice({ enabled: false });
    expect(calls).toEqual(['prepare', 'release']);
    p.destroy();
  });

  // Quitter la répétition éteint le mode vocal tout autant que décocher sa case :
  // garder la route laisserait la lecture continue en qualité d'enregistrement.
  it('rend la route audio en repassant en lecture continue', async () => {
    const calls: string[] = [];
    const traced = {
      ...rec.api,
      prepare: () => (calls.push('prepare'), Promise.resolve()),
      release: () => (calls.push('release'), Promise.resolve()),
    };
    const p = build({ voice: { recognizer: traced, enabled: true } });
    p.play();
    await flush();
    expect(calls).toEqual(['prepare']);

    p.setSettings({ rehearsal: false });
    expect(calls).toEqual(['prepare', 'release']);

    p.setSettings({ rehearsal: true }); // et la reprend en y revenant
    expect(calls).toEqual(['prepare', 'release', 'prepare']);
    p.destroy();
  });

  it("retire de la transcription ce qui a été capté de l'autre réplique", async () => {
    const p = build();
    p.play();
    await flush();
    Object.defineProperty(audios[0]!, 'duration', { value: 5, configurable: true });
    audios[0]!.dispatchEvent(new Event('loadedmetadata'));
    await flush();
    await tick(4100);
    // La fin de la réplique de l'autre, captée pendant la chauffe. Volontairement
    // plus longue que le départ libre de l'alignement : c'est ce qui distingue un
    // retrait réel d'une amorce que l'alignement aurait absorbée de toute façon.
    const capté = 'alors tu pars vraiment ce soir sans rien dire';
    rec.say(capté);
    await flush();
    audios[0]!.dispatchEvent(new Event('ended'));
    await flush();
    await tick(TO_MIC);
    // Le moteur rend l'énoncé complet depuis l'ouverture du micro : ma réplique
    // arrive derrière la sienne, et c'est la mienne seule qui doit être jugée.
    rec.say(`${capté} ${TEXT.toLowerCase()}`);
    await flush();
    expect(last?.currentNodeId).toBe('b#1'); // validée, sans attendre le silence
    p.destroy();
  });

  it('ferme le micro chaud si l’utilisateur intervient', async () => {
    const p = build();
    p.play();
    await flush();
    Object.defineProperty(audios[0]!, 'duration', { value: 5, configurable: true });
    audios[0]!.dispatchEvent(new Event('loadedmetadata'));
    await flush();
    await tick(4100);
    expect(rec.live).toBe(true);
    p.pause();
    expect(rec.live).toBe(false);
    p.destroy();
  });

  it('valide sur un résultat partiel, sans attendre le silence', async () => {
    const p = build();
    await upToMic(p);
    rec.say(TEXT.toLowerCase());
    await flush();
    expect(rec.live).toBe(false); // micro coupé dès la validation
    expect(last?.currentNodeId).toBe('b#1'); // on est déjà passé à la suite
    p.destroy();
  });

  it('clôt la tentative après le silence quand rien ne valide plus tôt', async () => {
    const p = build();
    await upToMic(p);
    rec.say('je ne reviendrai jamais dans cette');
    await flush();
    expect(last?.voice?.phase).toBe('listening');
    await tick(900);
    expect(last?.voice?.phase).toBe('failed');
    expect(last?.voice?.failures).toBe(1);
    expect(last?.currentNodeId).toBe('m#0'); // toujours bloqué sur ma réplique
    p.destroy();
  });

  it('affiche les écarts et ne passe jamais à la suite sur une erreur', async () => {
    const p = build();
    await upToMic(p);
    rec.finalize('je reviendrai dans cette maison');
    await flush();
    const words = last?.voice?.result?.words ?? [];
    expect(words.find((w) => w.text === 'jamais')?.status).toBe('missing');
    expect(last?.currentNodeId).toBe('m#0');
    p.destroy();
  });

  it('rejoue le modèle après exactement deux échecs, puis réécoute compteur à zéro', async () => {
    const p = build();
    await upToMic(p);

    rec.finalize('je reviendrai');
    await flush();
    expect(last?.voice?.failures).toBe(1);

    await tick(900); // le micro se rouvre pour la 2e tentative
    expect(rec.live).toBe(true);
    const startsBefore = rec.starts;
    rec.finalize('je reviendrai');
    await flush();
    expect(last?.voice?.failures).toBe(2);

    await tick(900);
    expect(last?.voice?.phase).toBe('reference');
    expect(rec.live).toBe(false); // le micro ne doit rien entendre du modèle
    const audio = audios[0]!;
    expect(audio.src).toContain('m#0');

    audio.dispatchEvent(new Event('ended'));
    await flush();
    expect(last?.voice?.failures).toBe(0);
    expect(rec.starts).toBe(startsBefore + 1);
    expect(last?.currentNodeId).toBe('m#0'); // le modèle n'a pas fait avancer la lecture
    p.destroy();
  });

  it('valide de justesse une réplique brodée, et enchaîne', async () => {
    const p = build();
    await upToMic(p);
    rec.finalize(`${TEXT.toLowerCase()} tu sais`);
    await flush();
    expect(last?.voice?.phase).toBe('borderline');
    expect(last?.voice?.result?.added.map((a) => a.text)).toEqual(['tu', 'sais']);
    await tick(600);
    expect(last?.currentNodeId).toBe('b#1');
    p.destroy();
  });

  it('distingue l’absence de parole d’une erreur de texte', async () => {
    const p = build();
    await upToMic(p);
    await tick(6100);
    expect(last?.voice?.phase).toBe('no-speech');
    expect(last?.voice?.failures).toBe(0); // ce n'est pas un échec : pas de modèle en vue
    p.destroy();
  });

  it('rend la main après deux tentatives muettes', async () => {
    const p = build();
    await upToMic(p);
    await tick(6100);
    await tick(900); // 2e écoute
    expect(rec.live).toBe(true);
    await tick(6100);
    expect(last?.voice?.message).toContain('Rien entendu');
    expect(rec.live).toBe(false);
    await tick(5000);
    expect(rec.live).toBe(false); // et ça ne se rallume pas tout seul
    p.destroy();
  });

  // « Deux tentatives muettes » veut dire deux d'affilée : une réplique dite entre
  // les deux, même fausse, prouve qu'il y a quelqu'un.
  it('ne compte comme muettes que des tentatives consécutives', async () => {
    const p = build();
    await upToMic(p);
    await tick(6100); // 1er silence
    await tick(900);
    rec.finalize('je reviendrai'); // on parle, mais faux
    await flush();
    expect(last?.voice?.failures).toBe(1);
    await tick(900);
    await tick(6100); // 2e silence, mais pas consécutif au premier
    expect(last?.voice?.message).toBeNull(); // la main n'est pas rendue
    expect(last?.voice?.phase).toBe('no-speech');
    p.destroy();
  });

  // Le scénario réel : on valide une tirade, la réplique de l'autre se joue, et il
  // faut que l'écoute reparte sur la suivante. C'est le deuxième tour qui casse
  // quand une écoute close continue de parler par-dessus la nouvelle.
  it('réécoute sur ma tirade suivante, après celle d’un autre', async () => {
    document.body.innerHTML =
      '<div id="c">' +
      `<p class="line" data-cid="moi" data-nid="m#0"><span class="speech">${TEXT}</span></p>` +
      '<p class="line" data-cid="benji" data-nid="b#0"><span class="speech">Bon.</span></p>' +
      '<p class="line" data-cid="moi" data-nid="m#1"><span class="speech">Je pars demain.</span></p>' +
      '</div>';
    container = document.getElementById('c') as HTMLElement;

    const p = build();
    p.play();
    await flush();
    await tick(TO_MIC);
    expect(rec.live).toBe(true);
    rec.say(TEXT.toLowerCase());
    await flush();
    expect(last?.currentNodeId).toBe('b#0'); // validée, on enchaîne sur l'autre

    audios[0]!.dispatchEvent(new Event('ended'));
    await flush();
    await tick(TO_MIC);
    expect(rec.live).toBe(true); // le micro se rouvre pour ma seconde tirade
    expect(last?.voice?.phase).toBe('listening');
    rec.say('je pars demain');
    await flush();
    expect(last?.voice?.phase).not.toBe('error');
    p.destroy();
  });

  it('coupe l’écoute net quand le mode est désactivé', async () => {
    const p = build();
    await upToMic(p);
    expect(rec.live).toBe(true);
    p.setVoice({ enabled: false });
    expect(rec.live).toBe(false);
    expect(last?.voice).toBeNull();
    expect(last?.waitingForUser).toBe(true); // la pause ordinaire reprend la main
    p.destroy();
  });

  it('coupe l’écoute sur un geste de l’utilisateur', async () => {
    const p = build();
    await upToMic(p);
    p.next();
    await flush();
    expect(rec.live).toBe(false);
    p.destroy();
  });

  it('reste inerte quand la répétition est éteinte', async () => {
    const p = build({ settings: { rehearsal: false } });
    p.play();
    await flush();
    await tick(TO_MIC);
    expect(rec.live).toBe(false);
    expect(last?.voice).toBeNull();
    p.destroy();
  });

  // Sur iOS, c'est `available()` qui déclenche la demande de permission : ne jamais
  // l'appeler ouvrirait le micro sans l'avoir obtenu, et `start()` échouerait sans
  // que personne n'ait vu passer la moindre demande.
  it("demande l'autorisation avant d'ouvrir le micro", async () => {
    const asked: string[] = [];
    const guarded = { ...rec.api, available: () => (asked.push('ask'), Promise.resolve(true)) };
    const p = build({ voice: { recognizer: guarded, enabled: true } });
    await upToMic(p);
    expect(asked).toEqual(['ask']);
    expect(rec.live).toBe(true);
    p.destroy();
  });

  // Un refus ne s'enferme pas : on peut accorder le micro dans les Réglages et
  // revenir sans avoir à relancer le lecteur.
  it('redemande l’autorisation après un refus', async () => {
    let granted = false;
    const flaky = { ...rec.api, available: () => Promise.resolve(granted) };
    const p = build({ voice: { recognizer: flaky, enabled: true } });
    await upToMic(p);
    expect(last?.voice?.phase).toBe('error');

    granted = true; // autorisé entre-temps, dans les Réglages
    p.next();
    await flush();
    p.prev();
    await flush();
    await tick(TO_MIC);
    expect(rec.starts).toBeGreaterThan(0);
    expect(last?.voice?.phase).not.toBe('error');
    p.destroy();
  });

  it("n'ouvre pas le micro quand l'autorisation est refusée", async () => {
    const denied = { ...rec.api, available: () => Promise.resolve(false) };
    const p = build({ voice: { recognizer: denied, enabled: true } });
    await upToMic(p);
    expect(rec.starts).toBe(0);
    expect(last?.voice?.phase).toBe('error');
    expect(last?.voice?.message).toContain('autorisé');
    p.destroy();
  });

  it('coupe le clip de référence quand le mode est désactivé en pleine lecture', async () => {
    const paused: string[] = [];
    HTMLMediaElement.prototype.pause = function pause(this: HTMLMediaElement) {
      paused.push(this.src);
    };
    const p = build();
    await upToMic(p);
    rec.finalize('je reviendrai');
    await flush();
    await tick(900);
    rec.finalize('je reviendrai');
    await flush();
    await tick(900);
    expect(last?.voice?.phase).toBe('reference');
    paused.length = 0;

    p.setVoice({ enabled: false });
    expect(paused.some((src) => src.includes('m#0'))).toBe(true);
    p.destroy();
  });

  // Une erreur pendant la respiration laisse derrière elle le minuteur qui joue le
  // signal et arme l'écoute : s'il tire, la boucle repart en contredisant l'erreur.
  it('ne relance rien après une erreur survenue avant le signal', async () => {
    const p = build();
    p.play();
    await flush();
    audios[0]!.dispatchEvent(new Event('ended'));
    await flush();
    expect(last?.voice?.phase).toBe('waiting');
    rec.fail('micro occupé');
    await flush();
    expect(last?.voice?.phase).toBe('error');
    await tick(10000); // bien après le signal, puis après le délai « aucune parole »
    expect(last?.voice?.phase).toBe('error');
    expect(rec.live).toBe(false);
    p.destroy();
  });

  it('remonte une erreur du moteur sans bloquer le lecteur', async () => {
    const p = build();
    await upToMic(p);
    rec.fail('micro refusé');
    await flush();
    expect(last?.voice?.phase).toBe('error');
    expect(last?.voice?.message).toBe('micro refusé');
    expect(rec.live).toBe(false);
    p.destroy();
  });

  /* Les ordres dits à voix haute pendant la pause : le seul moment où le micro est
     ouvert et où rien ne joue. La reconnaissance elle-même est éprouvée à part
     (@theatre/voice-match) ; ce qui se vérifie ici, c'est ce que le lecteur EN FAIT
     — et surtout qu'il ne laisse jamais un micro ouvert ni une pause morte. */
  describe('commandes vocales', () => {
    it('« passe » joue ma réplique, puis enchaîne', async () => {
      const p = build();
      await upToMic(p);
      rec.finalize('passe');
      await flush();
      expect(rec.live).toBe(false); // le micro ne doit rien entendre du clip
      expect(last?.waitingForUser).toBe(false); // la pause est levée
      const audio = audios[0]!;
      expect(audio.src).toContain('m#0'); // ma réplique, jouée
      audio.dispatchEvent(new Event('ended'));
      await flush();
      expect(last?.currentNodeId).toBe('b#1'); // puis on est passé à la suite
      p.destroy();
    });

    it('« indice » joue le début du clip, le coupe, et rouvre le micro', async () => {
      const p = build();
      await upToMic(p);
      const startsBefore = rec.starts;
      rec.finalize('indice');
      await flush();
      expect(last?.voice?.phase).toBe('command');
      expect(last?.voice?.command).toBe('hint');
      expect(rec.live).toBe(false);
      expect(audios[0]!.src).toContain('m#0');

      // Le clip n'a NI `ended` ni erreur : c'est la troncature qui rend la main.
      await tick(2000);
      await tick(TO_MIC);
      expect(rec.live).toBe(true);
      expect(rec.starts).toBe(startsBefore + 1);
      expect(last?.voice?.phase).toBe('listening');
      expect(last?.currentNodeId).toBe('m#0'); // l'indice n'a pas fait avancer la lecture
      p.destroy();
    });

    // Un indice n'est ni une faute ni un pardon : la référence complète reste due
    // au deuxième échec, sans qu'un coup de pouce remette le compteur à zéro.
    it('n’efface pas les échecs déjà accumulés', async () => {
      const p = build();
      await upToMic(p);
      rec.finalize('je reviendrai');
      await flush();
      expect(last?.voice?.failures).toBe(1);
      await tick(900);
      rec.finalize('indice');
      await flush();
      await tick(2000);
      await tick(TO_MIC);
      expect(last?.voice?.failures).toBe(1);
      p.destroy();
    });

    /* La règle qui protège le texte : ce qui entoure l'ordre le disqualifie. */
    it('ne prend pas pour un ordre ce qui n’en est qu’un morceau', async () => {
      const p = build();
      await upToMic(p);
      rec.finalize('passe la porte et referme-la');
      await flush();
      expect(last?.voice?.phase).toBe('failed'); // une tentative ratée, pas un saut
      expect(last?.currentNodeId).toBe('m#0');
      p.destroy();
    });

    /* Et quand la tirade contient elle-même l'ordre, c'est la pièce qui gagne. */
    it('désactive l’ordre que ma réplique contient', async () => {
      document.body.innerHTML =
        '<div id="c">' +
        '<p class="line" data-cid="benji" data-nid="b#0"><span class="speech">Tu pars ?</span></p>' +
        '<p class="line" data-cid="moi" data-nid="m#0"><span class="speech">Je passe par là, et je te croise.</span></p>' +
        '</div>';
      container = document.getElementById('c') as HTMLElement;
      const p = build();
      await upToMic(p);
      rec.finalize('passe');
      await flush();
      expect(last?.voice?.phase).toBe('failed');
      expect(last?.currentNodeId).toBe('m#0');
      // L'autre formulation, elle, reste utilisable : on n'est pas enfermé.
      await tick(900);
      rec.finalize('suivant');
      await flush();
      expect(last?.waitingForUser).toBe(false);
      expect(last?.playing).toBe(true);
      p.destroy();
    });

    describe('navigation par scène', () => {
      const RANGES: Record<string, string> = { 'b#0': 'h-1', 'm#0': 'h-1', 'b#1': 'h-2' };
      const withRanges = (): ReturnType<typeof build> =>
        build({ rangeOf: (t) => RANGES[t.nodeId] ?? null });

      it('« scène suivante » saute à la première tirade de la scène d’après', async () => {
        const p = withRanges();
        await upToMic(p);
        rec.finalize('scène suivante');
        await flush();
        expect(rec.live).toBe(false);
        expect(last?.currentNodeId).toBe('b#1');
        expect(last?.playing).toBe(true); // la lecture repart toute seule
        p.destroy();
      });

      it('« début de la scène » repart de la première tirade de la scène courante', async () => {
        const p = withRanges();
        await upToMic(p);
        rec.finalize('on reprend');
        await flush();
        expect(last?.currentNodeId).toBe('b#0');
        expect(last?.playing).toBe(true);
        p.destroy();
      });

      /* Cas limite du « on reprend » : le début de la scène est MA réplique, donc
         l'ordre nous ramène sur la pause depuis laquelle il a été dit. Le coach se
         voit alors clore son épisode et en rouvrir un dans le même souffle — c'est
         là qu'un micro peut rester ouvert ou, à l'inverse, ne jamais se rouvrir. */
      it('rouvre proprement l’écoute quand la scène commence par ma réplique', async () => {
        // Ma réplique OUVRE sa plage : l'ordre ramène donc exactement là où on est.
        const p = build({ rangeOf: (t) => (t.nodeId === 'b#0' ? 'h-1' : 'h-2') });
        await upToMic(p);
        rec.finalize('début de la scène');
        await flush();
        expect(last?.currentNodeId).toBe('m#0');
        await tick(TO_MIC);
        expect(last?.voice?.phase).toBe('listening');
        expect(rec.live).toBe(true); // ni micro oublié, ni écoute jamais rouverte
        p.destroy();
      });

      /* Un ordre sans destination ne doit pas laisser une pause micro fermé qui
         n'attend plus rien : une lecture bloquée, et rien à l'écran pour le dire. */
      it('rouvre l’écoute quand il n’y a pas de scène suivante', async () => {
        const p = build({ rangeOf: () => 'h-1' }); // une seule plage : rien après
        await upToMic(p);
        rec.finalize('scène suivante');
        await flush();
        expect(last?.currentNodeId).toBe('m#0'); // on n'a pas bougé
        await tick(900 + TO_MIC);
        expect(rec.live).toBe(true);
        expect(last?.voice?.message).toContain('Rien à cet endroit');
        p.destroy();
      });

      it('rouvre l’écoute quand l’hôte n’a pas fourni de plages', async () => {
        const p = build(); // pas de rangeOf
        await upToMic(p);
        rec.finalize('début de la scène');
        await flush();
        expect(last?.currentNodeId).toBe('m#0');
        await tick(900 + TO_MIC);
        expect(rec.live).toBe(true);
        p.destroy();
      });
    });
  });
});
