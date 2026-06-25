/**
 * Modèle d'une note utilisateur et son ancrage.
 *
 * Une note s'accroche à un bloc rendu (réplique/didascalie/en-tête) repéré par
 * un **identifiant de contenu stable** `nodeId` (émis en `data-nid` par le rendu,
 * cf. `buildNodeIds`) et à une plage de caractères [start, end) dans le
 * `textContent` de ce bloc. `quote` mémorise le texte sélectionné : si à la
 * relecture la plage ne redonne pas `quote`, la note est « orpheline » (non
 * perdue, listée à part). L' id étant dérivé du contenu du nœud, la note suit
 * les insertions/réordonnancements au-dessus, mais devient orpheline si le
 * contenu du nœud annoté change. Module pur, sans DOM ni I/O.
 */

import type { Node, Play } from './ast';

export interface Note {
  id: string;
  /** Identifiant de contenu stable du bloc (≙ attribut data-nid du rendu). */
  nodeId: string;
  /** Décalages caractères dans le textContent du bloc. */
  start: number;
  end: number;
  /** Texte sélectionné, pour détecter l'orphelin. */
  quote: string;
  /** Texte libre de la note. */
  body: string;
  createdAt: string;
  updatedAt: string;
}

/** Empreinte canonique du contenu d'un nœud (indépendante de sa position). */
function canonicalContent(node: Node): string {
  switch (node.type) {
    case 'act':
      return `A:${node.label}`;
    case 'scene':
      return `C:${node.label}`;
    case 'stage':
      return `S:${node.text}`;
    case 'line':
      return `L:${node.characterId}|${node.segments.map((s) => `${s.type[0]}:${s.text}`).join('|')}`;
  }
}

/** Hash déterministe FNV-1a 32 bits, encodé en base 36. */
function hashStr(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * Identifiant de contenu stable par nœud (même ordre que `play.nodes`).
 * `hash(contenu)#ordinal` : l'ordinal départage des nœuds au contenu identique
 * dans l'ordre du document. Stable face aux insertions/réordonnancements ;
 * change si le contenu du nœud change.
 */
export function buildNodeIds(play: Play): string[] {
  const counts = new Map<string, number>();
  return play.nodes.map((node) => {
    const h = hashStr(canonicalContent(node));
    const ord = counts.get(h) ?? 0;
    counts.set(h, ord + 1);
    return `${h}#${ord}`;
  });
}

/**
 * Résout la plage d'une note contre le texte courant d'un bloc.
 * Renvoie `{ start, end }` si la citation correspond toujours, sinon `null`
 * (note orpheline).
 */
export function resolveNote(
  nodeText: string,
  note: { start: number; end: number; quote: string },
): { start: number; end: number } | null {
  if (note.start < 0 || note.end > nodeText.length || note.start >= note.end) return null;
  return nodeText.slice(note.start, note.end) === note.quote
    ? { start: note.start, end: note.end }
    : null;
}
