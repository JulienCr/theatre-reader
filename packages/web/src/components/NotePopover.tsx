/**
 * Bulle d'une note, positionnée près du passage. Deux usages :
 * - création (note absente) : zone de texte + Enregistrer ;
 * - consultation/édition (note présente) : texte éditable + Enregistrer/Supprimer.
 * En lecture seule (editable=false), affiche seulement le texte.
 */
import { useEffect, useRef, useState } from 'react';
import type { Note } from '@theatre/core';

export interface PopoverTarget {
  note: Note | null; // null ⇒ création
  rect: DOMRect;
}

export function NotePopover({
  target,
  editable,
  onSave,
  onDelete,
  onClose,
}: {
  target: PopoverTarget;
  editable: boolean;
  onSave: (body: string) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [body, setBody] = useState(target.note?.body ?? '');
  const ref = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setBody(target.note?.body ?? '');
    if (editable) setTimeout(() => taRef.current?.focus(), 0);
  }, [target, editable]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const top = window.scrollY + target.rect.bottom + 6;
  const left = window.scrollX + target.rect.left;

  return (
    <div className="note-popover" ref={ref} style={{ top, left }}>
      {editable ? (
        <>
          <textarea
            ref={taRef}
            className="note-popover-text"
            value={body}
            placeholder="Votre note…"
            onChange={(e) => setBody(e.target.value)}
          />
          <div className="note-popover-actions">
            {target.note && (
              <button className="note-del" onClick={onDelete} title="Supprimer">
                Supprimer
              </button>
            )}
            <div className="spacer" />
            <button onClick={onClose}>Annuler</button>
            <button className="primary" disabled={!body.trim()} onClick={() => onSave(body.trim())}>
              Enregistrer
            </button>
          </div>
        </>
      ) : (
        <div className="note-popover-readonly">{target.note?.body}</div>
      )}
    </div>
  );
}
