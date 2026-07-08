/**
 * Câble la couche @theatre/annotations sur un conteneur rendu :
 * (re)décore quand les notes ou la clé de rendu changent, et active la création
 * par sélection quand `editable`. Les callbacks doivent être stables
 * (useCallback côté appelant) pour éviter des recalages superflus.
 */
import { useEffect, type RefObject } from 'react';
import { decorate, enableCreation, type AnchorDraft } from '@theatre/annotations';
import type { Note } from '@theatre/core';

export function useAnnotations(
  containerRef: RefObject<HTMLElement | null>,
  notes: Note[],
  opts: {
    editable: boolean;
    /** Change quand le HTML rendu change (re-décoration nécessaire). */
    redecorateKey: unknown;
    onActivate: (id: string, rect: DOMRect) => void;
    onRequestCreate: (anchor: AnchorDraft, rect: DOMRect) => void;
    onOrphans?: (orphans: Note[]) => void;
  },
): void {
  const { editable, redecorateKey, onActivate, onRequestCreate, onOrphans } = opts;

  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    const { orphans } = decorate(c, notes, { onActivate });
    onOrphans?.(orphans);
  }, [containerRef, notes, redecorateKey, onActivate, onOrphans]);

  useEffect(() => {
    const c = containerRef.current;
    if (!c || !editable) return;
    return enableCreation(c, { onRequestCreate });
  }, [containerRef, editable, redecorateKey, onRequestCreate]);
}
