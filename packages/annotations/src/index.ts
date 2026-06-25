/**
 * Couche d'annotation DOM, sans framework — partagée par l'app web (aperçu +
 * lecteur) et le runtime mobile en lecture seule.
 *
 * Décore les passages annotés : pour chaque note, retrouve le bloc `[data-ni]`,
 * résout sa plage via le `resolveNote` de @theatre/core, et enrobe la plage
 * dans des `<mark class="note-anchor" data-note-id>`. La création par sélection
 * est dans `creation.ts`.
 */

import { resolveNote, type Note } from '@theatre/core';

export const annotationCss = `
mark.note-anchor {
  background: #fff3bf;
  border-bottom: 2px solid #f0b429;
  border-radius: 2px;
  cursor: pointer;
}
mark.note-anchor:hover { background: #ffe8a3; }
`;

export { enableCreation, type AnchorDraft } from './creation';

const NOTE_ATTR = 'data-note-id';

/** Retire toutes les marques d'annotation et restaure le texte du conteneur. */
export function clearAnnotations(container: HTMLElement): void {
  const marks = container.querySelectorAll<HTMLElement>('mark.note-anchor');
  marks.forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  });
}

/**
 * Enrobe la plage [start, end) (décalages dans le textContent du bloc) dans un
 * ou plusieurs `<mark>` (un par nœud texte traversé, p.ex. à cheval sur la cue
 * et la réplique). Renvoie les marques créées.
 */
export function wrapOffsets(
  block: HTMLElement,
  start: number,
  end: number,
  noteId: string,
): HTMLElement[] {
  const texts: Text[] = [];
  const walker = block.ownerDocument.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let n: Node | null;
  while ((n = walker.nextNode())) texts.push(n as Text);

  const marks: HTMLElement[] = [];
  let acc = 0;
  for (const t of texts) {
    const nodeStart = acc;
    const nodeEnd = acc + t.data.length;
    acc = nodeEnd;
    const s = Math.max(start, nodeStart);
    const e = Math.min(end, nodeEnd);
    if (s >= e) continue;
    let piece = t;
    if (s > nodeStart) piece = piece.splitText(s - nodeStart); // piece démarre à s
    if (e < nodeEnd) piece.splitText(e - s); // piece couvre [s, e)
    const mark = block.ownerDocument.createElement('mark');
    mark.className = 'note-anchor';
    mark.setAttribute(NOTE_ATTR, noteId);
    piece.parentNode!.replaceChild(mark, piece);
    mark.appendChild(piece);
    marks.push(mark);
  }
  return marks;
}

/**
 * Décore le conteneur d'après les notes. Re-décorer est idempotent (on nettoie
 * d'abord). Renvoie les notes orphelines (bloc absent ou citation décrochée).
 */
export function decorate(
  container: HTMLElement,
  notes: Note[],
  opts: { onActivate?: (id: string, rect: DOMRect) => void } = {},
): { orphans: Note[] } {
  clearAnnotations(container);
  const orphans: Note[] = [];
  for (const note of notes) {
    const block = container.querySelector<HTMLElement>(`[data-nid="${note.nodeId}"]`);
    const range = block ? resolveNote(block.textContent ?? '', note) : null;
    if (!block || !range) {
      orphans.push(note);
      continue;
    }
    const marks = wrapOffsets(block, range.start, range.end, note.id);
    for (const mark of marks) {
      mark.addEventListener('click', (ev) => {
        ev.stopPropagation();
        opts.onActivate?.(note.id, mark.getBoundingClientRect());
      });
    }
  }
  return { orphans };
}
