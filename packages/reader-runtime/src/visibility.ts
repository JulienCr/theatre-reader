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

/**
 * Pose (et retire) `.scene--hidden` sur les plages masquées de `.play`.
 *
 * La classe est posée ET retirée à chaque passage : c'est le seul chemin de
 * démasquage quand l'utilisateur décoche l'option.
 */
export function applySceneVisibility(play: HTMLElement, v: SceneVisibility): void {
  walkRanges(play, (el, range, isHead) => {
    el.classList.toggle(HIDDEN_SCENE_CLASS, isHead ? v.headings.has(range) : v.ranges.has(range));
  });
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
