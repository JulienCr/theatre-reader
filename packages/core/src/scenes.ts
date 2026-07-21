/**
 * Découpage de la pièce en scènes et présence des personnages.
 *
 * Le modèle est une liste plate (`Play.nodes`) : une scène va d'un `SceneNode`
 * jusqu'au prochain `scene`/`act`. « Qui joue dans la scène » = les
 * `LineNode.characterId` de cette plage. Aucun regroupement par scène n'existait
 * ailleurs (`buildToc` ne produit que des en-têtes), d'où ce module — pur, sans DOM
 * ni I/O. Les ids de scène (`h-<index de nœud>`) sont identiques à ceux de
 * `buildToc`, pour que le lecteur mobile relie `data.toc` à la présence embarquée.
 */
import type { Node, Play } from './ast';

interface SceneRange {
  /** Index du `SceneNode` dans `play.nodes`. */
  start: number;
  /** Index (exclu) du premier nœud après le contenu de la scène. */
  end: number;
  /** Personnages ayant au moins une réplique dans la scène (1re apparition). */
  characterIds: string[];
}

/** Plages de scènes avec les personnages présents. Base commune, non exportée. */
function sceneRanges(play: Play): SceneRange[] {
  const ranges: SceneRange[] = [];
  const nodes = play.nodes;
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i]!.type !== 'scene') continue;
    const seen = new Set<string>();
    const characterIds: string[] = [];
    let j = i + 1;
    for (; j < nodes.length; j++) {
      const n = nodes[j]!;
      if (n.type === 'scene' || n.type === 'act') break;
      if (n.type === 'line' && !seen.has(n.characterId)) {
        seen.add(n.characterId);
        characterIds.push(n.characterId);
      }
    }
    ranges.push({ start: i, end: j, characterIds });
  }
  return ranges;
}

/**
 * Personnages présents dans chaque scène, par id d'en-tête (`h-<index>`, comme
 * `buildToc`). Embarqué à l'export pour que le lecteur mobile filtre sans l'AST.
 */
export function sceneMembers(play: Play): { id: string; characterIds: string[] }[] {
  return sceneRanges(play).map((r) => ({ id: `h-${r.start}`, characterIds: r.characterIds }));
}

/**
 * Ne garde que les scènes où au moins un des `roleIds` a une réplique.
 *
 * Raisonnement par bloc d'acte (d'un en-tête d'acte au suivant) : si un acte a des
 * scènes mais qu'AUCUNE ne survit, tout le bloc est retiré — en-tête ET contenu
 * hors-scène (didascalie d'ouverture comprise). C'est le comportement « je saute
 * l'acte entier » et il aligne le web sur le lecteur mobile (qui masque de même).
 * Sinon on garde le bloc en retirant seulement les plages de scènes exclues. Le
 * contenu avant le premier acte n'a pas d'en-tête : on y filtre juste les scènes.
 *
 * `roleIds` vide, ou rien à exclure → renvoie `play` inchangé (même référence :
 * évite une re-pagination inutile côté web).
 */
export function filterScenesByRoles(play: Play, roleIds: string[]): Play {
  if (!roleIds.length) return play;
  const roles = new Set(roleIds);
  const nodes = play.nodes;
  const kept: Node[] = [];
  let i = 0;
  while (i < nodes.length) {
    const isAct = nodes[i]!.type === 'act';
    // Fin du bloc : le prochain en-tête d'acte, ou la fin.
    let j = i + 1;
    while (j < nodes.length && nodes[j]!.type !== 'act') j++;
    // Scènes du bloc + leurs plages exclues.
    const excluded = new Set<number>();
    let hadScene = false;
    let keptScene = false;
    let k = isAct ? i + 1 : i;
    while (k < j) {
      if (nodes[k]!.type !== 'scene') {
        k++;
        continue;
      }
      hadScene = true;
      const start = k++;
      let present = false;
      while (k < j && nodes[k]!.type !== 'scene') {
        const n = nodes[k]!;
        if (n.type === 'line' && roles.has(n.characterId)) present = true;
        k++;
      }
      if (present) keptScene = true;
      else for (let x = start; x < k; x++) excluded.add(x);
    }
    // Acte entièrement muet pour ces rôles → on drop tout le bloc.
    if (!(isAct && hadScene && !keptScene)) {
      for (let x = i; x < j; x++) if (!excluded.has(x)) kept.push(nodes[x]!);
    }
    i = j;
  }
  return kept.length === nodes.length ? play : { ...play, nodes: kept };
}
