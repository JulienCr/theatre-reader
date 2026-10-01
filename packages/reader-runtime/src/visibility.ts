/**
 * Application au DOM de la décision « n'afficher que mes scènes ».
 *
 * La règle elle-même vit dans @theatre/core (`sceneVisibility`) : le lecteur web
 * filtre l'AST, le mobile masque le DOM, mais tous deux partent du MÊME verdict.
 * Une règle réécrite ici est ce qui avait laissé le contenu hors-scène échapper au
 * filtre — visible et joué alors qu'on avait demandé à ne voir que ses scènes.
 *
 * Séparé de Chrome.tsx pour être testable : la config vitest racine ne ramasse que
 * les `.test.ts` sous `packages`, sans transformation JSX.
 */
import { HIDDEN_SCENE_CLASS } from '@theatre/audio-player';
import { LEAD_RANGE_ID, type SceneVisibility } from '@theatre/core';

/** Les deux seuls en-têtes émis par `renderBody` (cf. @theatre/core render.ts). */
const HEAD = 'h2.act, h3.scene';

/**
 * Rattache chaque nœud de `.play` à sa plage, en ordre de document.
 *
 * Le rendu de @theatre/core est PLAT : `.play` a pour enfants directs le préambule
 * (`header.play-header`, `section.distribution`, `nav.toc`) puis les nœuds de la
 * pièce, chacun porteur d'un `data-nid`. On ne visite QUE les porteurs de
 * `data-nid` — c'est ce qui garantit que le préambule reste visible même quand la
 * plage de tête (le contenu placé avant tout en-tête) tombe.
 *
 * Chaque en-tête ouvre une plage, le reste en hérite. C'est ce qui permet de traiter
 * la QUEUE d'un acte (son prologue) séparément de sa TÊTE — un acte dont une scène
 * survit reste un repère de structure.
 *
 * Factorisé parce que deux fonctions en dépendent (masquage et boucle) : deux
 * parcours concurrents finiraient par ne plus répondre la même chose à « à quelle
 * plage appartient ce nœud », et c'est exactement le genre de divergence qui a déjà
 * laissé du contenu hors-scène échapper au filtre.
 */
function walkRanges(
  play: HTMLElement,
  visit: (el: HTMLElement, rangeId: string, isHead: boolean) => void,
): void {
  let range = LEAD_RANGE_ID;
  for (const el of Array.from(play.children) as HTMLElement[]) {
    if (!el.hasAttribute('data-nid')) continue; // préambule : intouchable
    const isHead = el.matches(HEAD);
    if (isHead) range = el.id;
    visit(el, range, isHead);
  }
}

export type LineFilter = 'all' | 'mine' | 'mineWithCue';

/**
 * Pose (et retire) `.scene--hidden` sur `.play` : plages masquées par le verdict de
 * scène OU nœuds (`data-nid`) masqués par le filtre de répliques.
 *
 * La classe est posée ET retirée à chaque passage : c'est le seul chemin de
 * démasquage quand l'utilisateur décoche une option, et c'est pour cela que les deux
 * verdicts doivent être fusionnés ici plutôt qu'appliqués par deux passes.
 *
 * @returns whether any node changed state — a new verdict object can hide exactly the same nodes.
 */
export function applyVisibility(
  play: HTMLElement,
  v: SceneVisibility,
  lineHidden: ReadonlySet<string>,
): boolean {
  let changed = false;
  walkRanges(play, (el, range, isHead) => {
    const byScene = isHead ? v.headings.has(range) : v.ranges.has(range);
    const hide = byScene || lineHidden.has(el.getAttribute('data-nid')!);
    if (el.classList.contains(HIDDEN_SCENE_CLASS) !== hide) {
      el.classList.toggle(HIDDEN_SCENE_CLASS, hide);
      changed = true;
    }
  });
  return changed;
}

/** `data-nid` of the nodes the line filter hides. Empty for 'all' or when `roles` is empty. */
export function lineFilterHidden(
  play: HTMLElement,
  filter: LineFilter,
  roles: readonly string[],
): Set<string> {
  const out = new Set<string>();
  if (filter === 'all' || roles.length === 0) return out;
  const mine = new Set(roles);
  let pending: string[] = [];
  let prevLine: { nid: string; mine: boolean } | null = null;
  const flushPending = () => {
    for (const nid of pending) out.add(nid);
    pending = [];
  };
  walkRanges(play, (el, _range, isHead) => {
    const nid = el.getAttribute('data-nid')!;
    if (isHead) {
      flushPending();
      prevLine = null;
    } else if (el.matches('p.line')) {
      const isMine = mine.has(el.getAttribute('data-cid') ?? '');
      if (isMine) {
        pending = [];
        if (filter === 'mineWithCue' && prevLine && !prevLine.mine) out.delete(prevLine.nid);
      } else {
        flushPending();
        out.add(nid);
      }
      prevLine = { nid, mine: isMine };
    } else {
      pending.push(nid);
    }
  });
  flushPending();
  return out;
}

/** Element to keep in view after a visibility change: the speaking line, else `nid`, else the nearest visible node after it, else before it. */
export function visibleAnchor(play: HTMLElement, nid: string | null): HTMLElement | null {
  const speaking = play.querySelector<HTMLElement>('.line--speaking');
  if (speaking && !speaking.classList.contains(HIDDEN_SCENE_CLASS)) return speaking;
  if (nid === null) return null;
  const from = (Array.from(play.children) as HTMLElement[]).find(
    (el) => el.getAttribute('data-nid') === nid,
  );
  if (!from) return null;
  if (!from.classList.contains(HIDDEN_SCENE_CLASS)) return from;
  const isVisible = (el: Element): boolean =>
    el.hasAttribute('data-nid') && !el.classList.contains(HIDDEN_SCENE_CLASS);
  for (const step of ['nextElementSibling', 'previousElementSibling'] as const) {
    for (let el = from[step]; el; el = el[step]) {
      if (isVisible(el)) return el as HTMLElement;
    }
  }
  return null;
}

/**
 * `data-nid` → id de plage (`h-<n>` ou `LEAD_RANGE_ID`), pour la boucle du moteur
 * audio : il ne voit qu'une liste plate de tirades et n'a aucun autre moyen de
 * savoir où une scène finit.
 */
export function rangeIndex(play: HTMLElement): Map<string, string> {
  const out = new Map<string, string>();
  walkRanges(play, (el, range) => {
    const nid = el.getAttribute('data-nid');
    if (nid) out.set(nid, range);
  });
  return out;
}
