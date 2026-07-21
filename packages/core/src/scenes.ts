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
 * Ne garde que les scènes où au moins un des `roleIds` a une réplique. Les nœuds
 * hors-scène (en-têtes d'acte, contenu avant la première scène) sont conservés ;
 * un acte dont plus aucune scène/contenu ne survit est retiré. `roleIds` vide, ou
 * aucune scène à exclure → renvoie `play` inchangé (même référence : évite une
 * re-pagination inutile côté web).
 */
export function filterScenesByRoles(play: Play, roleIds: string[]): Play {
  if (!roleIds.length) return play;
  const roles = new Set(roleIds);
  const excluded = new Set<number>();
  for (const r of sceneRanges(play)) {
    if (!r.characterIds.some((c) => roles.has(c))) {
      for (let k = r.start; k < r.end; k++) excluded.add(k);
    }
  }
  if (!excluded.size) return play;
  const kept = play.nodes.filter((_, i) => !excluded.has(i));
  return { ...play, nodes: dropEmptyActs(kept) };
}

/** Retire un en-tête d'acte suivi de rien ou d'un autre acte (aucun contenu survivant). */
function dropEmptyActs(nodes: Node[]): Node[] {
  return nodes.filter((node, i) => {
    if (node.type !== 'act') return true;
    const next = nodes[i + 1];
    return next !== undefined && next.type !== 'act';
  });
}
