/**
 * Coup d'œil (« peek ») sur une réplique floutée : rester appuyé la dévoile, le
 * relâchement la refloute.
 *
 * En répétition, mes répliques sont floutées tant qu'elles n'ont pas été dites
 * (cf. le masquage de @theatre/audio-player). Quand le texte ne revient pas, le
 * seul recours était de taper la réplique — mais taper, c'est s'y placer : on
 * déplaçait la lecture pour un simple trou de mémoire, et la position ainsi
 * avancée déflouttait tout ce qui précède. Le maintien dévoile sans rien changer
 * à l'état du lecteur.
 *
 * DOM pur, sans React ni moteur audio : le lecteur web et le lecteur mobile
 * exporté ont besoin du même geste et n'ont pas le même hôte. Le module ne pose
 * qu'une classe (`line--peek`) ; le défloutage lui-même est du CSS, dupliqué là
 * où l'est déjà le reste du masque (`reader-runtime/src/styles.ts` et
 * `web/src/styles.css`).
 *
 * Il ne connaît pas le `Player` et ne lui parle pas : le masquage reste une
 * fonction de la position de lecture, que le peek ne touche jamais. Les deux
 * couches se croisent sur une seule chose — le clic avalé ci-dessous.
 */

/**
 * Maintien avant défloutage. Sensiblement plus court que l'appui long du système
 * (500 ms), qui se fait sentir quand on cherche un mot ; assez long pour qu'un
 * tap franc (~100-150 ms) reste un tap et continue de déplacer la lecture.
 */
export const PEEK_DELAY_MS = 350;

/** Au-delà, le doigt défile : l'appui n'en est plus un. */
const MOVE_TOLERANCE_PX = 10;

export interface PeekOptions {
  /** Le DOM de la pièce (`.play`), tel que rendu par @theatre/core. */
  container: HTMLElement;
  /** Maintien avant défloutage, en ms. Défaut `PEEK_DELAY_MS`. */
  delayMs?: number;
  /** Déplacement toléré pendant le maintien, en px. Défaut 10. */
  moveTolerance?: number;
  /** Classe des répliques masquées (celle du moteur). Défaut 'line--masked'. */
  maskedClass?: string;
  /** Classe des répliques déjà révélées (celle du moteur). Défaut 'line--revealed'. */
  revealedClass?: string;
  /** Classe posée le temps du coup d'œil. Défaut 'line--peek'. */
  peekClass?: string;
}

export interface PeekController {
  /** Débranche tout et refloute ce qui était dévoilé. */
  destroy(): void;
}

export function createPeek(opts: PeekOptions): PeekController {
  const delayMs = opts.delayMs ?? PEEK_DELAY_MS;
  const tolerance = opts.moveTolerance ?? MOVE_TOLERANCE_PX;
  const maskedClass = opts.maskedClass ?? 'line--masked';
  const revealedClass = opts.revealedClass ?? 'line--revealed';
  const peekClass = opts.peekClass ?? 'line--peek';

  let timer: ReturnType<typeof setTimeout> | null = null;
  let origin: { x: number; y: number } | null = null;
  let shown: HTMLElement[] = [];
  // Armé par un coup d'œil abouti, consommé par le `click` qui suit le relâchement.
  let swallowClick = false;

  /** Tous les fragments d'une tirade : Paged.js peut la couper sur deux pages. */
  function fragmentsOf(nodeId: string): HTMLElement[] {
    const safe = nodeId.replace(/"/g, '\\"');
    return Array.from(opts.container.querySelectorAll<HTMLElement>(`p.line[data-nid="${safe}"]`));
  }

  function disarm(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    origin = null;
  }

  function hide(): void {
    for (const el of shown) el.classList.remove(peekClass);
    shown = [];
  }

  function onPointerDown(e: PointerEvent): void {
    // Un nouvel appui repart d'un clic autorisé : sans ça, un coup d'œil dont le
    // `click` ne serait jamais venu (doigt relâché hors du texte) avalerait à sa
    // place le tap suivant, qui lui était légitime.
    swallowClick = false;
    disarm();
    hide();
    if (e.button !== 0) return; // clic droit / auxiliaire
    const t = e.target;
    if (!(t instanceof Element)) return; // ex. appui sur un nœud texte
    const line = t.closest(`p.line.${maskedClass}`) as HTMLElement | null;
    // Déjà révélée : rien à dévoiler, et surtout aucun clic à avaler — on lui
    // laisserait perdre son tap sans que rien ne se soit passé à l'écran.
    if (!line || line.classList.contains(revealedClass)) return;
    const nodeId = line.getAttribute('data-nid');
    if (!nodeId) return;
    origin = { x: e.clientX, y: e.clientY };
    timer = setTimeout(() => {
      timer = null;
      shown = fragmentsOf(nodeId);
      for (const el of shown) el.classList.add(peekClass);
      swallowClick = true;
    }, delayMs);
  }

  function onPointerMove(e: PointerEvent): void {
    // Seulement pendant le maintien : une fois le texte dévoilé, un doigt qui
    // tremble ne doit pas le reprendre en pleine lecture. Si c'est un vrai
    // défilement qui s'engage, le navigateur émet `pointercancel`.
    if (timer === null || !origin) return;
    if (Math.hypot(e.clientX - origin.x, e.clientY - origin.y) <= tolerance) return;
    disarm();
  }

  function onRelease(): void {
    disarm();
    hide();
  }

  /**
   * Le clic qui suit un coup d'œil ne doit pas remonter : les deux lecteurs
   * écoutent `click` sur ce même conteneur pour se placer sur la réplique tapée
   * (`playFrom`/`seek`). En capture sur le conteneur, on est appelé avant leur
   * écouteur en bulle — regarder ne déplace pas la lecture.
   */
  function onClickCapture(e: MouseEvent): void {
    if (!swallowClick) return;
    swallowClick = false;
    e.stopPropagation();
    e.preventDefault();
  }

  opts.container.addEventListener('pointerdown', onPointerDown);
  opts.container.addEventListener('click', onClickCapture, true);
  // Sur window : le doigt peut se relever hors du texte, et l'appui doit finir
  // quand même — un flou resté ouvert ne se voit pas, il se subit.
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onRelease);
  window.addEventListener('pointercancel', onRelease);
  window.addEventListener('blur', onRelease);

  return {
    destroy(): void {
      opts.container.removeEventListener('pointerdown', onPointerDown);
      opts.container.removeEventListener('click', onClickCapture, true);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onRelease);
      window.removeEventListener('pointercancel', onRelease);
      window.removeEventListener('blur', onRelease);
      onRelease();
    },
  };
}
