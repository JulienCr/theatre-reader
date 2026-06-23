/**
 * Modèle d'une note utilisateur et son ancrage « simple + orphelin ».
 *
 * Une note s'accroche à un bloc rendu (réplique/didascalie/en-tête) repéré par
 * `nodeIndex` (index dans `play.nodes`, émis en `data-ni` par le rendu) et à une
 * plage de caractères [start, end) dans le `textContent` de ce bloc. `quote`
 * mémorise le texte sélectionné : si à la relecture la plage ne redonne pas
 * `quote`, la note est « orpheline » (non perdue, listée à part). Aucun
 * ré-ancrage flou. Module pur, sans DOM ni I/O.
 */

export interface Note {
  id: string;
  /** Index du bloc dans play.nodes (≙ attribut data-ni du rendu). */
  nodeIndex: number;
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
