/** Panneau latéral : toutes les notes (passage cité + extrait), + orphelines. */
import type { Note } from '@theatre/core';

export function NotesPanel({
  notes,
  orphans,
  onJump,
}: {
  notes: Note[];
  orphans: Note[];
  onJump: (note: Note) => void;
}) {
  const orphanIds = new Set(orphans.map((o) => o.id));
  const active = notes.filter((n) => !orphanIds.has(n.id));
  return (
    <div className="notes-panel">
      <div className="pane-title">Notes ({notes.length})</div>
      {notes.length === 0 && <p className="notes-empty">Sélectionnez des mots pour annoter.</p>}
      <ul className="notes-list">
        {active.map((n) => (
          <li key={n.id} className="note-item" onClick={() => onJump(n)}>
            <span className="note-quote">« {n.quote} »</span>
            <span className="note-body">{n.body}</span>
          </li>
        ))}
      </ul>
      {orphans.length > 0 && (
        <>
          <div className="notes-subtitle">Orphelines ({orphans.length})</div>
          <ul className="notes-list">
            {orphans.map((n) => (
              <li key={n.id} className="note-item note-item--orphan" onClick={() => onJump(n)}>
                <span className="note-quote">« {n.quote} »</span>
                <span className="note-body">{n.body}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
