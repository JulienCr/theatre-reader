// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPeek, PEEK_DELAY_MS, type PeekController } from './peek';

/** Un appui : `pointerdown` sur la cible, le reste sur window (le doigt peut sortir). */
function down(el: Element, x = 10, y = 10): void {
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, pointerId: 1 }));
}
function move(x: number, y: number): void {
  window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x, clientY: y, pointerId: 1 }));
}
function up(): void {
  window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
}
function cancel(): void {
  window.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 }));
}

describe('@theatre/reader-ui — peek (appui long sur une réplique floutée)', () => {
  let root: HTMLElement;
  let peek: PeekController;
  /** Ce que verrait le moteur audio : son `click` sur le conteneur (cf. Chrome.tsx). */
  let clicks: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <div class="play">
        <p class="line line--masked" data-nid="a#0" data-cid="c1"><span class="speech">Ma première réplique</span></p>
        <p class="line line--masked" data-nid="b#0" data-cid="c1"><span class="speech">Ma seconde, page 1</span></p>
        <p class="line line--masked" data-nid="b#0" data-cid="c1"><span class="speech">sa suite, page 2</span></p>
        <p class="line line--masked line--revealed" data-nid="c#0" data-cid="c1"><span class="speech">Déjà dite</span></p>
        <p class="line" data-nid="d#0" data-cid="c2"><span class="speech">Réplique d'un autre</span></p>
      </div>`;
    root = document.querySelector('.play') as HTMLElement;
    clicks = [];
    root.addEventListener('click', (e) => {
      const line = (e.target as Element).closest('p.line');
      clicks.push(line?.getAttribute('data-nid') ?? '?');
    });
    peek = createPeek({ container: root });
  });

  afterEach(() => {
    peek.destroy();
    vi.useRealTimers();
  });

  const speechOf = (nid: string) => document.querySelector(`p.line[data-nid="${nid}"] .speech`) as HTMLElement;
  const linesOf = (nid: string) => Array.from(document.querySelectorAll(`p.line[data-nid="${nid}"]`));
  const peeked = (nid: string) => linesOf(nid).map((el) => el.classList.contains('line--peek'));

  it('défloute après le délai de maintien, et pas avant', () => {
    down(speechOf('a#0'));
    vi.advanceTimersByTime(PEEK_DELAY_MS - 1);
    expect(peeked('a#0')).toEqual([false]);
    vi.advanceTimersByTime(1);
    expect(peeked('a#0')).toEqual([true]);
  });

  it('refloute au relâchement', () => {
    down(speechOf('a#0'));
    vi.advanceTimersByTime(PEEK_DELAY_MS);
    up();
    expect(peeked('a#0')).toEqual([false]);
  });

  it('défloute tous les fragments de la tirade (réplique coupée par Paged.js)', () => {
    down(speechOf('b#0'));
    vi.advanceTimersByTime(PEEK_DELAY_MS);
    expect(peeked('b#0')).toEqual([true, true]);
    up();
    expect(peeked('b#0')).toEqual([false, false]);
  });

  it('annule quand le doigt part en défilement', () => {
    down(speechOf('a#0'), 10, 10);
    move(12, 40); // au-delà de la tolérance
    vi.advanceTimersByTime(PEEK_DELAY_MS);
    expect(peeked('a#0')).toEqual([false]);
  });

  it("tolère le tremblement du doigt sous le seuil", () => {
    down(speechOf('a#0'), 10, 10);
    move(13, 14);
    vi.advanceTimersByTime(PEEK_DELAY_MS);
    expect(peeked('a#0')).toEqual([true]);
  });

  it('annule sur pointercancel (le navigateur prend la main pour défiler)', () => {
    down(speechOf('a#0'));
    vi.advanceTimersByTime(PEEK_DELAY_MS);
    expect(peeked('a#0')).toEqual([true]);
    cancel();
    expect(peeked('a#0')).toEqual([false]);
  });

  it('avale le clic qui suit un peek — regarder ne déplace pas la lecture', () => {
    down(speechOf('a#0'));
    vi.advanceTimersByTime(PEEK_DELAY_MS);
    up();
    speechOf('a#0').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(clicks).toEqual([]);
  });

  it('laisse passer le clic quand le tap est bref', () => {
    down(speechOf('a#0'));
    vi.advanceTimersByTime(PEEK_DELAY_MS - 50);
    up();
    speechOf('a#0').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(clicks).toEqual(['a#0']);
  });

  it("n'avale qu'un seul clic : le tap suivant se place normalement", () => {
    down(speechOf('a#0'));
    vi.advanceTimersByTime(PEEK_DELAY_MS);
    up();
    speechOf('a#0').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    down(speechOf('b#0'));
    up();
    speechOf('b#0').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(clicks).toEqual(['b#0']);
  });

  it('ignore une réplique déjà révélée — rien à dévoiler, et le clic passe', () => {
    down(speechOf('c#0'));
    vi.advanceTimersByTime(PEEK_DELAY_MS);
    expect(peeked('c#0')).toEqual([false]);
    up();
    speechOf('c#0').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(clicks).toEqual(['c#0']);
  });

  it("ignore une réplique qui n'est pas masquée", () => {
    down(speechOf('d#0'));
    vi.advanceTimersByTime(PEEK_DELAY_MS);
    expect(peeked('d#0')).toEqual([false]);
  });

  it('refloute quand la fenêtre perd le focus, doigt encore posé', () => {
    down(speechOf('a#0'));
    vi.advanceTimersByTime(PEEK_DELAY_MS);
    window.dispatchEvent(new Event('blur'));
    expect(peeked('a#0')).toEqual([false]);
  });

  it('destroy() refloute et débranche tout', () => {
    down(speechOf('a#0'));
    vi.advanceTimersByTime(PEEK_DELAY_MS);
    peek.destroy();
    expect(peeked('a#0')).toEqual([false]);
    down(speechOf('a#0'));
    vi.advanceTimersByTime(PEEK_DELAY_MS);
    expect(peeked('a#0')).toEqual([false]);
  });
});
