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
 * Pose (et retire) `.scene--hidden` sur les plages masquées de `.play`.
 *
 * Le rendu de @theatre/core est PLAT : `.play` a pour enfants directs le préambule
 * (`header.play-header`, `section.distribution`, `nav.toc`) puis les nœuds de la
 * pièce, chacun porteur d'un `data-nid`. On ne touche QUE les porteurs de
 * `data-nid` — c'est ce qui garantit que le préambule reste visible même quand la
 * plage de tête (le contenu placé avant tout en-tête) tombe.
 *
 * Un seul passage en ordre de document : chaque en-tête ouvre une plage, le reste
 * en hérite. C'est ce qui permet de masquer la QUEUE d'un acte (son prologue) sans
 * sa TÊTE — un acte dont une scène survit reste un repère de structure.
 *
 * La classe est posée ET retirée à chaque passage : c'est le seul chemin de
 * démasquage quand l'utilisateur décoche l'option.
 */
export function applySceneVisibility(play: HTMLElement, v: SceneVisibility): void {
  let hidden = v.ranges.has(LEAD_RANGE_ID);
  for (const el of Array.from(play.children) as HTMLElement[]) {
    if (!el.hasAttribute('data-nid')) continue; // préambule : intouchable
    if (el.matches(HEAD)) {
      hidden = v.ranges.has(el.id);
      el.classList.toggle(HIDDEN_SCENE_CLASS, v.headings.has(el.id));
      continue;
    }
    el.classList.toggle(HIDDEN_SCENE_CLASS, hidden);
  }
}
