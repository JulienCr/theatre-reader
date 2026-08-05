/**
 * Découpage de la pièce en plages et présence des personnages.
 *
 * Le modèle est une liste plate (`Play.nodes`). Une plage va d'un en-tête
 * (`act`/`scene`) jusqu'au prochain en-tête ; « qui joue » = les
 * `LineNode.characterId` de cette plage. Aucun regroupement n'existait ailleurs
 * (`buildToc` ne produit que des en-têtes), d'où ce module — pur, sans DOM ni I/O.
 *
 * DÉCOUPER PAR EN-TÊTE ET NON PAR SCÈNE EST LE POINT CENTRAL. Un acte porte
 * souvent du dialogue avant sa première scène (prologue), et une pièce peut en
 * porter avant tout en-tête. Ne modéliser que les scènes laissait ce contenu
 * invisible au filtre « mes scènes » : il restait affiché ET jouable quel que
 * soit le rôle — dans une pièce réelle, 85 répliques du narrateur en tête d'ACTE I
 * que le lecteur audio enchaînait alors qu'on avait demandé à ne voir que ses scènes.
 *
 * Les ids de plage (`h-<index de l'en-tête>`) sont identiques à ceux de `buildToc`,
 * pour que le lecteur mobile relie `data.toc` à la présence embarquée.
 *
 * `sceneVisibility` est la RÈGLE UNIQUE de décision, partagée par les deux lecteurs :
 * le web filtre l'AST (`filterScenesByRoles`, juste en dessous), le mobile masque le
 * DOM à partir de la même sortie. Une règle réécrite de chaque côté est exactement
 * ce qui a laissé passer le trou ci-dessus.
 */
import type { Node, Play } from './ast';

/** Tête de pièce (avant tout en-tête), contenu propre d'un acte, ou scène. */
export type SceneRangeKind = 'lead' | 'act' | 'scene';

/** Id de la plage de tête : elle est la seule à n'avoir aucun en-tête. */
export const LEAD_RANGE_ID = 'lead';

interface SceneRange {
  kind: SceneRangeKind;
  /** Index du nœud d'en-tête dans `play.nodes` ; -1 pour la plage de tête. */
  head: number;
  /** Bornes du CONTENU, en-tête exclu : [from, to). */
  from: number;
  to: number;
  /** Personnages ayant au moins une réplique dans le contenu (1re apparition). */
  characterIds: string[];
}

/** Présence par plage, telle qu'embarquée à l'export pour le lecteur mobile. */
export interface SceneMember {
  /** `h-<index de l'en-tête>` (comme `buildToc`), ou `LEAD_RANGE_ID`. */
  id: string;
  kind: SceneRangeKind;
  characterIds: string[];
}

/**
 * Ce qui disparaît en mode « mes scènes ».
 *
 * Deux ensembles et non un seul, parce que masquer l'en-tête et masquer le contenu
 * sont deux questions distinctes : un acte dont seul le prologue tombe garde son
 * titre (repère de structure, et destination valide du saut de scène). D'où
 * l'invariant `headings ⊆ ranges` — on ne masque jamais un en-tête en laissant son
 * contenu.
 */
export interface SceneVisibility {
  /** Ids dont l'ÉLÉMENT d'en-tête est masqué. */
  headings: Set<string>;
  /** Ids dont le CONTENU est masqué. */
  ranges: Set<string>;
}

const isHead = (n: Node): boolean => n.type === 'act' || n.type === 'scene';

const rangeId = (r: SceneRange): string => (r.head >= 0 ? `h-${r.head}` : LEAD_RANGE_ID);

/**
 * Partition complète de `play.nodes` : chaque nœud appartient à exactement une
 * plage, en-tête compris. Base commune, non exportée.
 */
function sceneRanges(play: Play): SceneRange[] {
  const nodes = play.nodes;
  const ranges: SceneRange[] = [];

  const charsOf = (from: number, to: number): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (let k = from; k < to; k++) {
      const n = nodes[k]!;
      if (n.type === 'line' && !seen.has(n.characterId)) {
        seen.add(n.characterId);
        out.push(n.characterId);
      }
    }
    return out;
  };

  let i = 0;
  while (i < nodes.length && !isHead(nodes[i]!)) i++;
  // Tête de pièce : émise seulement si elle existe — rien à embarquer sinon.
  if (i > 0) ranges.push({ kind: 'lead', head: -1, from: 0, to: i, characterIds: charsOf(0, i) });

  while (i < nodes.length) {
    const head = i;
    const kind: SceneRangeKind = nodes[head]!.type === 'act' ? 'act' : 'scene';
    let j = head + 1;
    while (j < nodes.length && !isHead(nodes[j]!)) j++;
    // Émise MÊME vide (from === to) pour un acte suivi immédiatement d'une scène :
    // c'est elle qui matérialise le début de l'acte, donc le regroupement
    // acte → ses scènes dont dépend `sceneVisibility`.
    ranges.push({ kind, head, from: head + 1, to: j, characterIds: charsOf(head + 1, j) });
    i = j;
  }

  return ranges;
}

/**
 * Personnages présents par plage. Embarqué à l'export pour que le lecteur mobile
 * filtre sans avoir l'AST.
 */
export function sceneMembers(play: Play): SceneMember[] {
  return sceneRanges(play).map((r) => ({
    id: rangeId(r),
    kind: r.kind,
    characterIds: r.characterIds,
  }));
}

/**
 * Décide ce que le mode « mes scènes » masque. Les deux lecteurs appellent CECI et
 * appliquent le résultat à leur substrat (AST côté web, DOM côté mobile) : c'est
 * ce qui les empêche de diverger.
 *
 * `roleIds` vide → rien de masqué. C'est aussi le chemin de démasquage complet
 * quand l'utilisateur décoche l'option.
 */
export function sceneVisibility(members: SceneMember[], roleIds: string[]): SceneVisibility {
  const headings = new Set<string>();
  const ranges = new Set<string>();
  if (!roleIds.length) return { headings, ranges };

  const roles = new Set(roleIds);
  const mine = (m: SceneMember): boolean => m.characterIds.some((c) => roles.has(c));
  // Une plage sans aucune réplique n'est à personne : didascalie d'ouverture, page
  // de garde. Elle suit son acte au lieu de tomber pour absence de dialogue.
  const speaks = (m: SceneMember): boolean => m.characterIds.length > 0;
  const hideAll = (m: SceneMember): void => {
    headings.add(m.id);
    ranges.add(m.id);
  };
  // Donnée d'un export antérieur à `kind` : rien que des scènes, on retombe sur la
  // règle historique (cf. « Template option back-compat » dans CLAUDE.md).
  const kindOf = (m: SceneMember): SceneRangeKind => m.kind ?? 'scene';

  let i = 0;
  while (i < members.length) {
    const m = members[i]!;

    if (kindOf(m) === 'lead') {
      // Pas d'acte parent : une tête BAVARDE où je ne joue pas disparaît, mais son
      // en-tête n'existe pas — seul le contenu tombe.
      if (speaks(m) && !mine(m)) ranges.add(m.id);
      i++;
      continue;
    }

    if (kindOf(m) === 'scene') {
      // Scène hors acte (pièce sans en-tête d'acte) : règle historique.
      if (!mine(m)) hideAll(m);
      i++;
      continue;
    }

    // Acte : lui et TOUTES ses scènes, jusqu'au prochain acte.
    const act = m;
    const scenes: SceneMember[] = [];
    let j = i + 1;
    while (j < members.length && kindOf(members[j]!) === 'scene') scenes.push(members[j++]!);

    if (!mine(act) && !scenes.some(mine)) {
      // Rien de moi nulle part dans l'acte → tout tombe, en-têtes compris.
      hideAll(act);
      for (const s of scenes) hideAll(s);
    } else {
      // L'acte survit : son en-tête RESTE (repère de structure). Seul son prologue
      // tombe, et seulement s'il a du dialogue dont aucun n'est à moi.
      if (speaks(act) && !mine(act)) ranges.add(act.id);
      for (const s of scenes) if (!mine(s)) hideAll(s);
    }

    i = j;
  }

  return { headings, ranges };
}

/**
 * Ne garde que ce que `sceneVisibility` laisse visible — la version AST du filtre,
 * pour le lecteur web qui re-rend la pièce au lieu de masquer du DOM.
 *
 * `roleIds` vide, ou rien à exclure → renvoie `play` inchangé (même référence :
 * évite une re-pagination Paged.js inutile).
 */
export function filterScenesByRoles(play: Play, roleIds: string[]): Play {
  if (!roleIds.length) return play;
  const ranges = sceneRanges(play);
  const v = sceneVisibility(
    ranges.map((r) => ({ id: rangeId(r), kind: r.kind, characterIds: r.characterIds })),
    roleIds,
  );

  const kept: Node[] = [];
  for (const r of ranges) {
    const id = rangeId(r);
    if (r.head >= 0 && !v.headings.has(id)) kept.push(play.nodes[r.head]!);
    if (v.ranges.has(id)) continue;
    for (let x = r.from; x < r.to; x++) kept.push(play.nodes[x]!);
  }
  return kept.length === play.nodes.length ? play : { ...play, nodes: kept };
}
