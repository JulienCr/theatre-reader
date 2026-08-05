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
      return () => partials.splice(partials.indexOf(cb), 1);
    },
    onFinal: (cb) => {
      finals.push(cb);
      return () => finals.splice(finals.indexOf(cb), 1);
    },
    onError: (cb) => {
      errors.push(cb);
      return () => errors.splice(errors.indexOf(cb), 1);
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

/** Respiration + signal : le temps qu'il faut au micro pour s'ouvrir. */
const TO_MIC = 700 + 200 + 10;

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

  it('respecte la respiration avant d’ouvrir le micro', async () => {
    const p = build();
    p.play();
    await flush();
    audios[0]!.dispatchEvent(new Event('ended'));
    await flush();
    expect(last?.voice?.phase).toBe('waiting');
    expect(rec.live).toBe(false);
    await tick(TO_MIC);
    expect(rec.live).toBe(true);
    expect(last?.voice?.phase).toBe('listening');
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
});
