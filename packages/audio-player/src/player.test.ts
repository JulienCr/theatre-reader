// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { createPlayer, type AudioTirade, type PlayerState } from './index';

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

  it('dédupe par data-nid et n\'extrait que le texte parlé (sans didascalie)', () => {
    const p = make();
    expect(p.getState().total).toBe(2);
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

  it('Répétition : pause silencieuse sur mon rôle (pas d\'audio)', async () => {
    const p = make((c) => c === 'benji');
    p.setMode('rehearsal');
    calls = [];
    p.playFrom('b#0');
    await flush();
    expect(last?.waitingForUser).toBe(true);
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
});
