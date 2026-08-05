// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPlayer, type AudioTirade, type PlayerOptions, type PlayerState } from './index';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('@theatre/audio-player', () => {
  let container: HTMLElement;
  let calls: AudioTirade[];
  let last: PlayerState | null;

  beforeEach(() => {
    // happy-dom n'implémente pas play/pause : on les neutralise.
    HTMLMediaElement.prototype.play = () => Promise.resolve();
    HTMLMediaElement.prototype.pause = () => {};
    document.body.innerHTML =
      '<div id="c">' +
      '<h2 class="act" data-nid="act#0">ACTE I</h2>' +
      '<p class="line" data-cid="michel" data-nid="a#0"><span class="cue">MICHEL</span><span class="cue-sep"> : </span><span class="speech">Bonjour</span> <span class="didascalie-inline">(à part)</span> <span class="speech">à tous.</span></p>' +
      '<p class="line" data-cid="benji" data-nid="b#0"><span class="cue">BENJI</span><span class="speech">Salut.</span></p>' +
      // Fragment dupliqué (simulate Paged.js) : même data-nid.
      '<p class="line" data-cid="a#0-dup" data-nid="a#0"><span class="speech">ignoré</span></p>' +
      '</div>';
    container = document.getElementById('c') as HTMLElement;
    calls = [];
    last = null;
  });

  const make = (isMine?: (c: string) => boolean) =>
    createPlayer({
      container,
      resolveAudio: (t) => {
        calls.push(t);
        return Promise.resolve(`blob:${t.nodeId}`);
      },
      isMine,
      onState: (s) => {
        last = s;
      },
    });

  // Fixtures sur mesure pour la répétition.
  const mount = (html: string): HTMLElement => {
    document.body.innerHTML = `<div id="c2">${html}</div>`;
    return document.getElementById('c2') as HTMLElement;
  };
  const line = (cid: string, nid: string, speech: string): string =>
    `<p class="line" data-cid="${cid}" data-nid="${nid}"><span class="cue">${cid}</span><span class="speech">${speech}</span></p>`;
  const buildPlayer = (cont: HTMLElement, extra: Partial<PlayerOptions> = {}) =>
    createPlayer({
      container: cont,
      resolveAudio: (t) => {
        calls.push(t);
        return Promise.resolve(`blob:${t.nodeId}`);
      },
      onState: (s) => {
        last = s;
      },
      ...extra,
    });

  it('dédupe par data-nid et n\'extrait que le texte parlé (sans didascalie)', () => {
    const p = make();
    expect(p.getState().total).toBe(2);
    p.destroy();
  });

  it('ignore les répliques d\'une scène masquée (option « mes scènes »)', () => {
    const cont = mount(
      '<h3 class="scene" data-nid="s1#0">SCENE I</h3>' +
        line('michel', 'm#0', 'Présent.') +
        // Plage masquée : la classe est posée sur chaque élément (comme le runtime mobile).
        '<h3 class="scene scene--hidden" data-nid="s2#0">SCENE II</h3>' +
        '<p class="line scene--hidden" data-cid="benji" data-nid="b#0"><span class="speech">Caché.</span></p>',
    );
    const p = buildPlayer(cont);
    expect(p.getState().total).toBe(1); // seule la réplique visible est indexée
    p.destroy();
  });

  it('joue la 1re tirade : surbrillance + resolveAudio', async () => {
    const p = make();
    p.play();
    await flush();
    const el = container.querySelector('[data-nid="a#0"]') as HTMLElement;
    expect(el.classList.contains('line--speaking')).toBe(true);
    expect(calls[0]?.nodeId).toBe('a#0');
    // texte = uniquement les .speech, didascalie exclue
    expect(calls[0]?.text).toBe('Bonjour à tous.');
    expect(last?.currentCharacterId).toBe('michel');
    p.destroy();
  });

  it('next() avance à la tirade suivante', async () => {
    const p = make();
    p.play();
    await flush();
    p.next();
    await flush();
    expect(last?.currentNodeId).toBe('b#0');
    const el = container.querySelector('[data-nid="b#0"]') as HTMLElement;
    expect(el.classList.contains('line--speaking')).toBe(true);
    p.destroy();
  });

  it('répétition : pause silencieuse sur mon rôle (playMine=false, pas d\'audio)', async () => {
    const p = make((c) => c === 'benji');
    p.setSettings({ rehearsal: true });
    calls = [];
    p.playFrom('b#0');
    await flush();
    expect(last?.waitingForUser).toBe(true);
    expect(last?.settings.rehearsal).toBe(true);
    expect(calls.find((t) => t.nodeId === 'b#0')).toBeUndefined();
    p.destroy();
  });

  it("s'arrête sur une erreur de synthèse (pas de course à travers la pièce)", async () => {
    let n = 0;
    const p = createPlayer({
      container,
      resolveAudio: () => {
        n++;
        return Promise.reject(new Error('boom'));
      },
      onState: (s) => {
        last = s;
      },
    });
    p.play();
    await flush();
    await flush();
    expect(last?.playing).toBe(false); // s'est arrêté
    expect(n).toBe(1); // n'a pas enchaîné les tirades suivantes
    p.destroy();
  });

  it('destroy() retire la surbrillance', async () => {
    const p = make();
    p.play();
    await flush();
    p.destroy();
    expect(container.querySelector('.line--speaking')).toBeNull();
  });

  // --- Répétition modulaire ---

  it('playMine : à la reprise, LIT ma réplique (reste sur elle)', async () => {
    const c = mount(line('michel', 'a#0', 'Un') + line('benji', 'b#0', 'Deux') + line('michel', 'a#1', 'Trois'));
    const p = buildPlayer(c, { roles: ['benji'], settings: { rehearsal: true, playMine: true, mask: true } });
    p.playFrom('a#0');
    await flush();
    p.next(); // → b#0, ma réplique : pause
    await flush();
    expect(last?.currentNodeId).toBe('b#0');
    expect(last?.waitingForUser).toBe(true);
    const b = c.querySelector('[data-nid="b#0"]') as HTMLElement;
    expect(b.classList.contains('line--masked')).toBe(true);
    expect(b.classList.contains('line--revealed')).toBe(false);
    calls.length = 0;
    p.resume(); // playMine : joue b#0 maintenant
    await flush();
    expect(last?.currentNodeId).toBe('b#0');
    expect(last?.waitingForUser).toBe(false);
    expect(calls.find((t) => t.nodeId === 'b#0')).toBeDefined();
    expect(b.classList.contains('line--revealed')).toBe(true);
    p.destroy();
  });

  it('playMine=false : à la reprise, SAUTE ma réplique (pas de TTS)', async () => {
    const c = mount(line('michel', 'a#0', 'Un') + line('benji', 'b#0', 'Deux') + line('michel', 'a#1', 'Trois'));
    const p = buildPlayer(c, { roles: ['benji'], settings: { rehearsal: true, playMine: false, mask: true } });
    p.playFrom('a#0');
    await flush();
    p.next(); // → b#0 : pause
    await flush();
    expect(last?.waitingForUser).toBe(true);
    calls.length = 0;
    p.resume(); // saute b#0 → a#1
    await flush();
    expect(last?.currentNodeId).toBe('a#1');
    expect(calls.find((t) => t.nodeId === 'b#0')).toBeUndefined();
    const b = c.querySelector('[data-nid="b#0"]') as HTMLElement;
    expect(b.classList.contains('line--revealed')).toBe(true);
    p.destroy();
  });

  it('avancement auto : pause de la durée du mp3 puis avance', async () => {
    vi.useFakeTimers();
    const c = mount(line('michel', 'a#0', 'Un') + line('benji', 'b#0', 'Deux') + line('michel', 'a#1', 'Trois'));
    const p = buildPlayer(c, {
      roles: ['benji'],
      settings: { rehearsal: true, autoAdvance: true, playMine: false, mask: true },
      resolveDuration: () => Promise.resolve(2),
    });
    p.playFrom('b#0');
    await vi.advanceTimersByTimeAsync(0); // flush microtâches : resolveDuration + emit minuté
    expect(last?.waitingForUser).toBe(true);
    expect(last?.timed).toBe(true);
    expect(last?.timedMs).toBe(2000);
    // barre de temps affichée en haut de ma tirade, animée sur la durée de la pause
    const b = c.querySelector('[data-nid="b#0"]') as HTMLElement;
    const fill = b.querySelector('.line-timer .line-timer-fill') as HTMLElement;
    expect(fill).not.toBeNull();
    expect(fill.style.width).toBe('100%');
    expect(fill.style.transition).toContain('2000ms');
    await vi.advanceTimersByTimeAsync(2000); // déclenche le minuteur
    expect(last?.currentNodeId).toBe('a#1');
    expect(b.classList.contains('line--revealed')).toBe(true);
    expect(c.querySelector('.line-timer')).toBeNull(); // barre retirée à l'avance
    p.destroy();
    vi.useRealTimers();
  });

  it('avancement auto : fallback estimation si durée indisponible (bornée)', async () => {
    vi.useFakeTimers();
    const c = mount(line('michel', 'a#0', 'Un') + line('benji', 'b#0', 'Deux mots ici') + line('michel', 'a#1', 'Trois'));
    const p = buildPlayer(c, {
      roles: ['benji'],
      settings: { rehearsal: true, autoAdvance: true },
      resolveAudio: (t) => {
        calls.push(t);
        return Promise.resolve(null); // pas de clip
      },
      resolveDuration: () => Promise.resolve(null),
    });
    p.playFrom('b#0');
    await vi.advanceTimersByTimeAsync(0);
    expect(last?.timed).toBe(true);
    expect(last?.timedMs).toBeGreaterThanOrEqual(1500);
    expect(last?.timedMs).toBeLessThanOrEqual(20000);
    p.destroy();
    vi.useRealTimers();
  });

  it('avancement auto : préfetch de ma réplique (pour sonder sa durée sans latence)', async () => {
    const c = mount(line('michel', 'a#0', 'Un') + line('benji', 'b#0', 'Deux'));
    const p = buildPlayer(c, {
      roles: ['benji'],
      settings: { rehearsal: true, autoAdvance: true, playMine: false },
    });
    p.playFrom('a#0'); // michel joue → préfetch de b#0 (ma réplique) car avancement auto
    await flush();
    expect(calls.find((t) => t.nodeId === 'b#0')).toBeDefined();
    p.destroy();
  });

  it('reveal() bascule le peek sur TOUS les fragments (Paged.js)', () => {
    const c = mount(
      line('michel', 'a#0', 'Un') +
        line('benji', 'b#0', 'Deux') +
        '<p class="line" data-cid="benji" data-nid="b#0"><span class="speech">Deux (suite)</span></p>',
    );
    const p = buildPlayer(c, { roles: ['benji'], settings: { rehearsal: true, mask: true } });
    const frags = c.querySelectorAll('[data-nid="b#0"]');
    expect(frags.length).toBe(2);
    frags.forEach((f) => expect(f.classList.contains('line--masked')).toBe(true));
    p.reveal('b#0');
    frags.forEach((f) => expect(f.classList.contains('line--revealed')).toBe(true));
    p.reveal('b#0');
    frags.forEach((f) => expect(f.classList.contains('line--revealed')).toBe(false));
    p.destroy();
  });

  it('lecture continue (rehearsal=false) : démasque tout', () => {
    const c = mount(line('michel', 'a#0', 'Un') + line('benji', 'b#0', 'Deux'));
    const p = buildPlayer(c, { roles: ['benji'], settings: { rehearsal: true, mask: true } });
    let b = c.querySelector('[data-nid="b#0"]') as HTMLElement;
    expect(b.classList.contains('line--masked')).toBe(true);
    p.setSettings({ rehearsal: false });
    b = c.querySelector('[data-nid="b#0"]') as HTMLElement;
    expect(b.classList.contains('line--masked')).toBe(false);
    p.destroy();
  });

  it('mask=false : pas de masquage même en répétition', () => {
    const c = mount(line('michel', 'a#0', 'Un') + line('benji', 'b#0', 'Deux'));
    const p = buildPlayer(c, { roles: ['benji'], settings: { rehearsal: true, mask: false } });
    const b = c.querySelector('[data-nid="b#0"]') as HTMLElement;
    expect(b.classList.contains('line--masked')).toBe(false);
    p.destroy();
  });

  it('setRoles : re-masque et ré-évalue la position en attente', async () => {
    const c = mount(line('michel', 'a#0', 'Un') + line('benji', 'b#0', 'Deux') + line('michel', 'a#1', 'Trois'));
    const p = buildPlayer(c, { roles: ['benji'], settings: { rehearsal: true, mask: true, playMine: false } });
    p.playFrom('b#0'); // benji, ma réplique → pause
    await flush();
    expect(last?.waitingForUser).toBe(true);
    let b = c.querySelector('[data-nid="b#0"]') as HTMLElement;
    expect(b.classList.contains('line--masked')).toBe(true);
    calls.length = 0;
    p.setRoles(['michel']); // désormais michel : b#0 n'est plus à moi → joue
    await flush();
    b = c.querySelector('[data-nid="b#0"]') as HTMLElement;
    expect(b.classList.contains('line--masked')).toBe(false);
    expect(calls.find((t) => t.nodeId === 'b#0')).toBeDefined();
    const a0 = c.querySelector('[data-nid="a#0"]') as HTMLElement;
    expect(a0.classList.contains('line--masked')).toBe(true);
    p.destroy();
  });

  it('multi-rôle : pause sur chacun de mes rôles', async () => {
    const c = mount(line('michel', 'a#0', 'Un') + line('benji', 'b#0', 'Deux'));
    const p = buildPlayer(c, { roles: ['michel', 'benji'], settings: { rehearsal: true } });
    p.playFrom('a#0'); // michel est un de mes rôles → pause
    await flush();
    expect(last?.currentNodeId).toBe('a#0');
    expect(last?.waitingForUser).toBe(true);
    p.resume(); // saute → b#0, aussi un de mes rôles → re-pause
    await flush();
    expect(last?.currentNodeId).toBe('b#0');
    expect(last?.waitingForUser).toBe(true);
    p.destroy();
  });

  it('deux répliques « mine » consécutives : re-pause', async () => {
    const c = mount(
      line('michel', 'a#0', 'Un') +
        line('benji', 'b#0', 'Deux') +
        line('benji', 'b#1', 'Trois') +
        line('michel', 'a#1', 'Quatre'),
    );
    const p = buildPlayer(c, { roles: ['benji'], settings: { rehearsal: true, playMine: false } });
    p.playFrom('a#0');
    await flush();
    p.next(); // → b#0 : pause
    await flush();
    expect(last?.currentNodeId).toBe('b#0');
    expect(last?.waitingForUser).toBe(true);
    p.resume(); // saute b#0 → b#1 (aussi à moi) → re-pause
    await flush();
    expect(last?.currentNodeId).toBe('b#1');
    expect(last?.waitingForUser).toBe(true);
    p.destroy();
  });

  it('playMine : réplique « mine » sans voix — avance sans blocage à la reprise', async () => {
    const c = mount(line('michel', 'a#0', 'Un') + line('benji', 'b#0', 'Deux') + line('michel', 'a#1', 'Trois'));
    const p = buildPlayer(c, {
      roles: ['benji'],
      settings: { rehearsal: true, playMine: true, mask: true },
      resolveAudio: (t) => {
        calls.push(t);
        return Promise.resolve(t.nodeId === 'b#0' ? null : `blob:${t.nodeId}`);
      },
    });
    p.playFrom('a#0');
    await flush();
    p.next(); // → b#0 : pause
    await flush();
    expect(last?.waitingForUser).toBe(true);
    p.resume(); // playMine → tente de jouer b#0 (null) → enchaîne a#1 sans blocage
    await flush();
    await flush();
    expect(last?.currentNodeId).toBe('a#1');
    const b = c.querySelector('[data-nid="b#0"]') as HTMLElement;
    expect(b.classList.contains('line--revealed')).toBe(true);
    p.destroy();
  });

  it('tic : bip joué à la pause uniquement si activé', async () => {
    let osc = 0;
    class FakeCtx {
      state = 'running';
      currentTime = 0;
      resume(): Promise<void> {
        return Promise.resolve();
      }
      createOscillator(): unknown {
        osc++;
        return { frequency: { value: 0 }, connect: (n: unknown) => n, start() {}, stop() {} };
      }
      createGain(): unknown {
        return {
          gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
          connect: (n: unknown) => n,
        };
      }
      get destination(): unknown {
        return {};
      }
    }
    const win = window as unknown as { AudioContext?: unknown };
    const origAudioContext = win.AudioContext;
    win.AudioContext = FakeCtx;
    try {
      const c = mount(line('michel', 'a#0', 'Un') + line('benji', 'b#0', 'Deux'));

      const p1 = buildPlayer(c, { roles: ['benji'], settings: { rehearsal: true, tick: false } });
      p1.playFrom('b#0');
      await flush();
      expect(osc).toBe(0);
      p1.destroy();

      osc = 0;
      const p2 = buildPlayer(c, { roles: ['benji'], settings: { rehearsal: true, tick: true } });
      p2.playFrom('b#0');
      await flush();
      expect(osc).toBe(1);
      p2.destroy();
    } finally {
      win.AudioContext = origAudioContext;
    }
  });

  describe('refresh() — repositionnement après masquage', () => {
    /** 5 répliques ; `hide` masque une plage comme le fait le runtime mobile. */
    const five = (): HTMLElement =>
      mount(
        line('michel', 'n1#0', 'Un') +
          line('michel', 'n2#0', 'Deux') +
          line('michel', 'n3#0', 'Trois') +
          line('benji', 'n4#0', 'Quatre') +
          line('benji', 'n5#0', 'Cinq'),
      );
    const hide = (cont: HTMLElement, ...nids: string[]): void => {
      for (const nid of nids) cont.querySelector(`[data-nid="${nid}"]`)!.classList.add('scene--hidden');
    };
    const showAll = (cont: HTMLElement): void => {
      cont.querySelectorAll('.scene--hidden').forEach((el) => el.classList.remove('scene--hidden'));
    };

    it('se replace sur la première tirade SUIVANTE encore visible', async () => {
      const cont = five();
      const p = buildPlayer(cont);
      p.playFrom('n2#0');
      await flush();
      hide(cont, 'n1#0', 'n2#0', 'n3#0');
      p.refresh();
      await flush();
      // Un clamp numérique aurait donné l'index 1 de la liste rétrécie, soit n5#0.
      expect(last?.currentNodeId).toBe('n4#0');
      p.destroy();
    });

    it('garde la position quand la tirade courante survit', async () => {
      const cont = five();
      const p = buildPlayer(cont);
      p.playFrom('n4#0');
      await flush();
      hide(cont, 'n1#0');
      p.refresh();
      await flush();
      expect(last?.currentNodeId).toBe('n4#0');
      expect(last?.total).toBe(4);
      p.destroy();
    });

    it('recule quand plus rien ne suit', async () => {
      const cont = five();
      const p = buildPlayer(cont);
      p.playFrom('n4#0');
      await flush();
      hide(cont, 'n4#0', 'n5#0');
      p.refresh();
      await flush();
      expect(last?.currentNodeId).toBe('n3#0');
      p.destroy();
    });

    it('survit à une pièce entièrement masquée', async () => {
      const cont = five();
      const p = buildPlayer(cont);
      p.playFrom('n2#0');
      await flush();
      hide(cont, 'n1#0', 'n2#0', 'n3#0', 'n4#0', 'n5#0');
      p.refresh();
      await flush();
      expect(last?.total).toBe(0);
      expect(last?.currentNodeId).toBeNull();
      p.destroy();
    });

    it('redevient un démarrage quand tout disparaît puis revient', async () => {
      const cont = five();
      const p = buildPlayer(cont);
      p.playFrom('n1#0');
      await flush();

      hide(cont, 'n1#0', 'n2#0', 'n3#0', 'n4#0', 'n5#0');
      p.refresh(); // plus rien à jouer : la lecture s'arrête hors bornes
      await flush();
      expect(last?.total).toBe(0);

      showAll(cont);
      p.refresh();
      await flush();
      p.next();
      await flush();
      // Sans remise à zéro de `started`, on repartirait sur n2#0.
      expect(last?.currentNodeId).toBe('n1#0');
      p.destroy();
    });

    it('coupe le son quand la tirade en cours vient d\'être masquée', async () => {
      const cont = five();
      const p = buildPlayer(cont);
      p.playFrom('n2#0');
      await flush();
      calls = [];
      hide(cont, 'n1#0', 'n2#0', 'n3#0');
      p.refresh();
      await flush();
      // La lecture reprend à la première visible, et n2#0 n'est jamais re-résolue.
      expect(calls.map((t) => t.nodeId)).toContain('n4#0');
      expect(calls.map((t) => t.nodeId)).not.toContain('n2#0');
      p.destroy();
    });
  });

  describe('premier ⏭ / ⏮', () => {
    it('démarre sur la tirade courante tant que rien n\'a été joué', async () => {
      const p = make();
      p.next();
      await flush();
      // Sans ça, le premier appui sauterait la première réplique de la scène.
      expect(last?.currentNodeId).toBe('a#0');
      p.next();
      await flush();
      expect(last?.currentNodeId).toBe('b#0');
      p.destroy();
    });

    it('redevient un démarrage après un refresh qui a déplacé la position', async () => {
      const cont = mount(line('michel', 'n1#0', 'Un') + line('benji', 'n2#0', 'Deux'));
      const p = buildPlayer(cont);
      cont.querySelector('[data-nid="n1#0"]')!.classList.add('scene--hidden');
      p.refresh();
      await flush();
      p.next();
      await flush();
      expect(last?.currentNodeId).toBe('n2#0');
      p.destroy();
    });
  });

  describe('boucle sur la plage courante', () => {
    // Le moteur ne voit qu'une liste plate : c'est l'hôte qui lui dit à quelle plage
    // appartient chaque tirade. Ici deux scènes de deux répliques.
    const RANGES: Record<string, string> = {
      'a#0': 'h-1',
      'b#0': 'h-1',
      'c#0': 'h-2',
      'd#0': 'h-2',
    };
    const twoScenes = (): HTMLElement =>
      mount(
        line('michel', 'a#0', 'Un') +
          line('benji', 'b#0', 'Deux') +
          line('michel', 'c#0', 'Trois') +
          line('benji', 'd#0', 'Quatre'),
      );

    /**
     * L'élément `<audio>` du moteur n'est jamais inséré dans le document : le test
     * l'intercepte à la création pour pouvoir lui envoyer `ended`, le seul événement
     * qui déclenche l'enchaînement — et donc la boucle.
     */
    const buildLooping = (
      cont: HTMLElement,
      extra: Partial<PlayerOptions> = {},
    ): { p: ReturnType<typeof buildPlayer>; endClip: () => void } => {
      const real = document.createElement.bind(document);
      const made: HTMLAudioElement[] = [];
      document.createElement = ((tag: string) => {
        const el = real(tag);
        if (tag === 'audio') made.push(el as HTMLAudioElement);
        return el;
      }) as typeof document.createElement;
      const p = buildPlayer(cont, { rangeOf: (t) => RANGES[t.nodeId] ?? null, ...extra });
      document.createElement = real;
      return { p, endClip: () => void made[0]!.dispatchEvent(new Event('ended')) };
    };

    it('repart de la première tirade de la plage au lieu d\'enchaîner sur la suivante', async () => {
      const { p, endClip } = buildLooping(twoScenes());
      p.setLoop(true);
      p.playFrom('a#0');
      await flush();
      endClip();
      await flush();
      expect(last?.currentNodeId).toBe('b#0'); // dans la plage : on avance normalement
      endClip();
      await flush();
      expect(last?.currentNodeId).toBe('a#0'); // bout de la plage : retour à son début
      p.destroy();
    });

    it('sans boucle, enchaîne sur la plage suivante', async () => {
      const { p, endClip } = buildLooping(twoScenes());
      p.playFrom('b#0');
      await flush();
      endClip();
      await flush();
      expect(last?.currentNodeId).toBe('c#0');
      p.destroy();
    });

    it('suit la plage où l\'on se trouve, pas celle où la boucle a été activée', async () => {
      const { p, endClip } = buildLooping(twoScenes());
      p.setLoop(true);
      p.playFrom('a#0');
      await flush();
      p.next(); // b#0
      await flush();
      p.next(); // ⏭ manuel : quitte la plage, c'est le seul moyen de changer de scène
      await flush();
      expect(last?.currentNodeId).toBe('c#0');
      endClip();
      await flush();
      expect(last?.currentNodeId).toBe('d#0');
      endClip();
      await flush();
      expect(last?.currentNodeId).toBe('c#0'); // c'est la seconde scène qui boucle
      p.destroy();
    });

    it('boucle aussi en fin de pièce', async () => {
      const { p, endClip } = buildLooping(twoScenes());
      p.setLoop(true);
      p.playFrom('d#0');
      await flush();
      endClip();
      await flush();
      expect(last?.currentNodeId).toBe('c#0');
      p.destroy();
    });

    /**
     * Sans garde-fou, une plage dont aucune réplique n'a de clip (export partiel,
     * personnages sans voix) enchaînerait les sauts pour l'éternité — et sans un son
     * pour s'en rendre compte. Ce test boucle vraiment si la protection saute.
     */
    it('s\'arrête au lieu de tourner à vide dans une plage sans aucun clip', async () => {
      const { p } = buildLooping(twoScenes(), {
        resolveAudio: (t) => {
          calls.push(t);
          return Promise.resolve(null);
        },
      });
      p.setLoop(true);
      p.playFrom('a#0');
      await flush();
      expect(last?.playing).toBe(false);
      p.destroy();
    });
  });

  describe('vitesse de lecture', () => {
    it('raccourcit la pause de l\'avancement automatique d\'autant', async () => {
      vi.useFakeTimers();
      const c = mount(
        line('michel', 'a#0', 'Un') + line('benji', 'b#0', 'Deux') + line('michel', 'a#1', 'Trois'),
      );
      const p = buildPlayer(c, {
        roles: ['benji'],
        settings: { rehearsal: true, autoAdvance: true, playMine: false, mask: true },
        resolveDuration: () => Promise.resolve(2),
      });
      p.setRate(2);
      p.playFrom('b#0');
      await vi.advanceTimersByTimeAsync(0);
      // À 2×, tout le reste va deux fois plus vite : attendre 2 s la durée nominale
      // ferait traîner chaque tour de parole.
      expect(last?.timedMs).toBe(1000);
      p.destroy();
      vi.useRealTimers();
    });

    it('refuse une vitesse nulle, qui rendrait la pause infinie', async () => {
      vi.useFakeTimers();
      const c = mount(line('michel', 'a#0', 'Un') + line('benji', 'b#0', 'Deux'));
      const p = buildPlayer(c, {
        roles: ['benji'],
        settings: { rehearsal: true, autoAdvance: true },
        resolveDuration: () => Promise.resolve(2),
      });
      p.setRate(0);
      p.playFrom('b#0');
      await vi.advanceTimersByTimeAsync(0);
      expect(last?.timedMs).toBe(2000);
      p.destroy();
      vi.useRealTimers();
    });
  });
});
