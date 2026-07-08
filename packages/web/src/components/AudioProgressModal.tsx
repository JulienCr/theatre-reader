/** Modale d'avancement de la pré-génération audio (bouton « Générer l'audio »). */

export interface AudioGenState {
  total: number;
  done: number;
  generated: number;
  cached: number;
  error: string | null;
  running: boolean;
}

export function AudioProgressModal({
  total,
  done,
  generated,
  cached,
  error,
  running,
  onCancel,
  onClose,
}: AudioGenState & { onCancel: () => void; onClose: () => void }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const finished = !running;
  return (
    <div className="progress-overlay">
      <div className="progress-card">
        <h3>Génération audio</h3>
        <progress className="progress-bar" value={done} max={total} />
        <div className="progress-line">
          {done} / {total} tirades traitées ({pct}%)
        </div>
        <div className="progress-tally">
          {generated} générée{generated > 1 ? 's' : ''} · {cached} déjà en cache
        </div>
        {error && <div className="progress-error">{error}</div>}
        {!error && finished && (
          <div className="progress-done">Terminé.</div>
        )}
        <div className="progress-actions">
          {running ? (
            <button onClick={onCancel}>Annuler</button>
          ) : (
            <button className="primary" onClick={onClose}>
              Fermer
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
