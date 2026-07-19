/**
 * Écran de choix : régler l'adresse du Mac, ouvrir une pièce, la préparer hors-ligne.
 *
 * S'affiche quand aucune pièce n'est demandée. Il doit rester utilisable SANS
 * serveur : c'est l'écran qu'on voit dans le métro ou en coulisses, où la seule
 * chose qui compte est de retrouver une pièce déjà rapatriée. Le serveur n'est
 * interrogé que pour enrichir cette liste et proposer la préparation.
 */
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@theatre/ui';
import * as api from '../api';
import { prepareOffline, type PrepareProgress, type PrepareResult } from '../offline/prepare';
import * as store from '../offline/store';
import { getApiBase, setApiBase } from '../settings';

interface PlayEntry {
  slug: string;
  name: string;
}

/** Bilan de la dernière préparation, épinglé sous la pièce concernée. */
interface Report extends PrepareResult {
  slug: string;
}

export function Picker() {
  const [base, setBase] = useState(getApiBase());
  const [plays, setPlays] = useState<PlayEntry[]>([]);
  const [localSlugs, setLocalSlugs] = useState<Set<string>>(new Set());
  /** Le serveur a répondu : conditionne la préparation hors-ligne et le message d'état. */
  const [online, setOnline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<PrepareProgress | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    const local = await store.listLocalPlays();
    setLocalSlugs(new Set(local.map((p) => p.slug)));

    let served: PlayEntry[] | null = null;
    if (getApiBase()) {
      try {
        served = (await api.listPlays()).plays;
      } catch {
        // Mac éteint, hors du tailnet, adresse fausse : tous ces cas se valent
        // ici, on bascule simplement sur ce qui est déjà dans le téléphone.
        served = null;
      }
    }
    setOnline(served !== null);
    setPlays(served ?? local);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function connect(): void {
    setApiBase(base);
    setBase(getApiBase());
    void refresh();
  }

  /**
   * Rechargement de la page plutôt que montage à chaud : `boot()` n'est appelable
   * qu'une fois par page et le runtime n'a pas d'API de démontage. Tout étant
   * local, le rechargement est instantané.
   */
  function open(slug: string): void {
    location.search = `?slug=${encodeURIComponent(slug)}`;
  }

  async function prepare(slug: string): Promise<void> {
    setBusy(slug);
    setReport(null);
    setError(null);
    setProgress({ done: 0, total: 0 });
    try {
      const result = await prepareOffline(slug, setProgress);
      setReport({ slug, ...result });
      await refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  return (
    <main className="picker">
      <h1>Mes pièces</h1>

      <label className="picker-label" htmlFor="api-base">
        Adresse du Mac (Tailscale)
      </label>
      <div className="picker-field">
        <input
          id="api-base"
          className="picker-input"
          type="url"
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="https://mon-mac.tailnet.ts.net"
          value={base}
          onChange={(e) => setBase(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') connect();
          }}
        />
        <Button variant="neutral" size="touch" onClick={connect}>
          Connecter
        </Button>
      </div>

      <section className="picker-section">
        <p className="picker-note">
          {loading
            ? 'Recherche des pièces…'
            : online
              ? 'Connecté au Mac.'
              : 'Hors ligne — Mac injoignable. Seules les pièces déjà préparées sont listées.'}
        </p>

        {error && <p className="picker-error">Erreur : {error}</p>}

        {!loading && plays.length === 0 && (
          <p className="picker-note">
            Aucune pièce. Renseigne l'adresse du Mac, puis prépare une pièce hors-ligne.
          </p>
        )}

        <ul className="picker-list">
          {plays.map((play) => (
            <li className="picker-play" key={play.slug}>
              <div className="picker-play-head">
                <span className="picker-play-name">{play.name}</span>
                {localSlugs.has(play.slug) && <span className="picker-tag">hors-ligne</span>}
              </div>
              <div className="picker-play-slug">{play.slug}</div>

              <div className="picker-actions">
                <Button variant="primary" size="touch" onClick={() => open(play.slug)}>
                  Ouvrir
                </Button>
                {/* Sans serveur il n'y a rien à rapatrier : le bouton disparaît
                    plutôt que d'échouer à l'usage. */}
                {online && (
                  <Button
                    variant="neutral"
                    size="touch"
                    disabled={busy !== null}
                    onClick={() => void prepare(play.slug)}
                  >
                    {busy === play.slug ? 'Préparation…' : 'Préparer hors-ligne'}
                  </Button>
                )}
              </div>

              {busy === play.slug && progress && <Progress progress={progress} />}
              {report?.slug === play.slug && <ReportNote report={report} />}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

function Progress({ progress }: { progress: PrepareProgress }) {
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <div className="picker-progress">
      <div className="picker-bar">
        <div className="picker-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="picker-progress-text">
        {progress.total ? `${progress.done} / ${progress.total} clips` : 'Lecture de la pièce…'}
      </span>
    </div>
  );
}

/**
 * Les clips manquants ne sont jamais synthétisés par la préparation (ElevenLabs
 * est facturé) : sans cette explication, l'utilisateur constaterait des répliques
 * muettes sans savoir quoi faire.
 */
function ReportNote({ report }: { report: Report }) {
  const ready = report.prepared + report.skipped;
  return (
    <p className="picker-report">
      {ready} clip{ready > 1 ? 's' : ''} prêt{ready > 1 ? 's' : ''} hors-ligne
      {report.skipped > 0 && ` (dont ${report.skipped} déjà présent${report.skipped > 1 ? 's' : ''})`}.
      {report.missing > 0 && (
        <>
          {' '}
          {report.missing} clip{report.missing > 1 ? 's' : ''} manquant
          {report.missing > 1 ? 's' : ''} sur le Mac : ces répliques resteront muettes. Lance
          « 🎙️ Générer l'audio » dans l'atelier web, puis relance la préparation.
        </>
      )}
    </p>
  );
}

/** Injecté par `main.ts` en même temps que `uiCss`, dont il consomme les jetons. */
export const pickerCss = `
.picker {
  max-width: 560px;
  margin: 0 auto;
  padding: var(--sp-5) 0 var(--sp-6);
  font-family: var(--font-ui);
  color: var(--ink);
}
.picker h1 { font-size: var(--fs-xl); margin: 0 0 var(--sp-5); }
.picker-label {
  display: block;
  font-size: var(--fs-sm);
  letter-spacing: var(--tracking-label);
  text-transform: uppercase;
  color: var(--ink-muted);
  margin-bottom: var(--sp-2);
}
.picker-field { display: flex; gap: var(--sp-2); }
.picker-input {
  flex: 1 1 auto;
  min-width: 0;
  height: var(--ctl-h-touch);
  padding: 0 var(--sp-3);
  font: inherit;
  font-size: var(--fs-lg);
  color: var(--ink);
  background: var(--paper-raised);
  border: 1px solid var(--rule-strong);
  border-radius: var(--r-md);
}
.picker-input:focus-visible { outline: none; box-shadow: var(--focus-ring); }
.picker-section { margin-top: var(--sp-6); }
.picker-note { font-size: var(--fs-md); color: var(--ink-muted); margin: 0 0 var(--sp-3); }
.picker-error { font-size: var(--fs-md); color: var(--danger); margin: 0 0 var(--sp-3); }
.picker-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--sp-3); }
.picker-play {
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: var(--r-lg);
  padding: var(--sp-4);
  box-shadow: var(--sh-1);
}
.picker-play-head { display: flex; align-items: center; gap: var(--sp-2); }
.picker-play-name { font-size: var(--fs-lg); font-weight: 600; }
.picker-tag {
  font-size: var(--fs-xs);
  letter-spacing: var(--tracking-label);
  text-transform: uppercase;
  color: var(--ok);
  border: 1px solid currentColor;
  border-radius: var(--r-full);
  padding: 1px var(--sp-2);
}
.picker-play-slug { font-family: var(--font-mono); font-size: var(--fs-sm); color: var(--ink-faint); }
.picker-actions { display: flex; flex-wrap: wrap; gap: var(--sp-2); margin-top: var(--sp-3); }
.picker-progress { display: flex; align-items: center; gap: var(--sp-3); margin-top: var(--sp-3); }
.picker-bar {
  flex: 1 1 auto;
  height: 6px;
  background: var(--paper-sunken);
  border-radius: var(--r-full);
  overflow: hidden;
}
.picker-bar-fill { height: 100%; background: var(--accent); }
.picker-progress-text { font-size: var(--fs-sm); color: var(--ink-muted); font-variant-numeric: tabular-nums; }
.picker-report { font-size: var(--fs-md); color: var(--ink-muted); margin: var(--sp-3) 0 0; line-height: 1.45; }
`;
