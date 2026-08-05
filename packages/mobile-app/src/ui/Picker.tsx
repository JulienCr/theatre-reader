/**
 * Écran d'accueil : retrouver une pièce, en télécharger une nouvelle.
 *
 * Il doit rester utilisable SANS serveur : c'est l'écran qu'on voit dans le métro
 * ou en coulisses, où la seule chose qui compte est de retrouver une pièce déjà
 * rapatriée. D'où l'ordre d'affichage — les pièces locales apparaissent tout de
 * suite, la recherche du Mac vient enrichir la liste ensuite.
 *
 * Tout ce qui concerne la connexion tient dans une pastille et une feuille :
 * l'adresse du Mac ne se saisit qu'en dépannage, elle n'a pas à occuper l'écran
 * en permanence.
 */
import { useCallback, useEffect, useState } from 'react';
import { loadResume, type ResumePoint } from '@theatre/reader-runtime';
import { storageKeyFor } from '@theatre/reader-ui';
import { Button, Icon, IconButton, Sheet } from '@theatre/ui';
import * as api from '../api';
import { discover, lanBase, type Instance } from '../discovery';
import { formatAge, formatBytes } from '../format';
import { prepareOffline, type PrepareProgress, type PrepareResult } from '../offline/prepare';
import * as store from '../offline/store';
import { getManualBase, setManualBase } from '../settings';

/** Une pièce telle qu'affichée : la fusion de ce qu'a le téléphone et de ce qu'a le Mac. */
interface Row {
  slug: string;
  name: string;
  /** Téléchargée sur ce téléphone, donc lisible sans réseau. */
  local: boolean;
  /** Clips audio présents localement ; 0 est normal (pièce sans voix configurée). */
  clips: number;
  /** Place prise par les clips sur le téléphone, en octets. */
  bytes: number;
  /** Fin de la dernière synchronisation ; absente des copies préparées avant son suivi. */
  preparedAt?: number;
  /** Dernière scène franchie dans le lecteur, si la pièce a déjà été ouverte. */
  resume?: ResumePoint;
}

type Status = 'searching' | 'online' | 'offline';

/** Bilan de la dernière préparation, épinglé sous la pièce concernée. */
interface Report extends PrepareResult {
  slug: string;
}

export function Picker() {
  const [rows, setRows] = useState<Row[]>([]);
  const [server, setServer] = useState<Instance | null>(null);
  const [status, setStatus] = useState<Status>('searching');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [manual, setManual] = useState(getManualBase());
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<PrepareProgress | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Slug de la pièce dont la feuille d'actions est ouverte. */
  const [actions, setActions] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    const local = await localRows();
    // Affiché avant toute requête : hors ligne, l'écran est complet dès la première
    // frame, et la recherche du Mac ne fait qu'y ajouter.
    setRows(local);
    setStatus('searching');

    const found = await discover();
    setServer(found);
    if (!found) {
      setStatus('offline');
      return;
    }
    try {
      const { plays } = await api.listPlays();
      setRows(merge(local, plays));
      setStatus('online');
    } catch {
      // `/api/health` a répondu mais pas la liste : serveur à moitié debout, on le
      // traite comme absent plutôt que d'afficher une liste vide trompeuse.
      setServer(null);
      setStatus('offline');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Rechargement de la page plutôt que montage à chaud : `boot()` n'est appelable
   * qu'une fois par page et le runtime n'a pas d'API de démontage. Tout étant
   * local, le rechargement est instantané.
   *
   * `sceneId` devient le fragment de l'URL : c'est `main.ts` qui l'atteint, une
   * fois la pièce injectée dans le DOM.
   */
  function open(slug: string, sceneId?: string): void {
    const anchor = sceneId ? `#${encodeURIComponent(sceneId)}` : '';
    location.assign(`${location.pathname}?slug=${encodeURIComponent(slug)}${anchor}`);
  }

  function saveManual(): void {
    setManualBase(manual);
    setManual(getManualBase());
    void load();
  }

  async function prepare(slug: string): Promise<void> {
    setBusy(slug);
    setReport(null);
    setError(null);
    setProgress({ done: 0, total: 0 });
    try {
      const result = await prepareOffline(slug, setProgress);
      setReport({ slug, ...result });
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  /**
   * Efface la copie locale. La ligne ne disparaît pas pour autant si le Mac est
   * joignable : la pièce y est toujours, elle redevient simplement « pas
   * téléchargée ». D'où le rechargement complet plutôt qu'un retrait de la liste.
   */
  async function forget(slug: string): Promise<void> {
    setActions(null);
    setError(null);
    try {
      await store.deletePlay(slug);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const nothingLocal = rows.every((r) => !r.local);
  const actionRow = rows.find((r) => r.slug === actions) ?? null;

  return (
    <main className="picker">
      <header className="picker-head">
        <h1 className="picker-title">Mes pièces</h1>
        <button
          type="button"
          className="picker-status"
          onClick={() => setSheetOpen(true)}
          aria-label="Connexion au Mac"
        >
          <span className={`picker-dot picker-dot--${status}`} aria-hidden="true" />
          <span className="picker-status-text">{statusLabel(status, server)}</span>
          <Icon name="chevron-right" size={16} className="picker-status-chevron" />
        </button>
      </header>

      {error && <p className="picker-error">Erreur : {error}</p>}

      {rows.length === 0 ? (
        <Empty status={status} onSearch={() => void load()} onSettings={() => setSheetOpen(true)} />
      ) : (
        <>
          {status === 'online' && nothingLocal && (
            <p className="picker-hint">Télécharge une pièce pour répéter sans réseau.</p>
          )}
          <ul className="picker-list">
            {rows.map((row) => (
              <li className="picker-row" key={row.slug}>
                <div className="picker-row-main">
                  <button
                    type="button"
                    className="picker-open"
                    onClick={() => open(row.slug, row.resume?.sceneId)}
                  >
                    <span className="picker-name">{row.name}</span>
                    <span className="picker-meta">{metaLabel(row)}</span>
                    {row.resume && (
                      <span className="picker-resume">
                        <Icon name="chevron-right" size={13} />
                        Reprendre · {row.resume.label}
                      </span>
                    )}
                  </button>
                  {/* Une seule action secondaire visible. Le bouton direct de
                      téléchargement ne se justifie que tant que c'est la seule chose
                      à faire de la pièce : dès qu'elle est sur le téléphone OU qu'une
                      reprise est mémorisée, il y a un choix à offrir (resynchroniser,
                      effacer, rouvrir depuis le début) et c'est le menu qui le porte.
                      Sans serveur il ne reste que le menu : rien à rapatrier. */}
                  {row.local || row.resume ? (
                    <IconButton
                      icon="more-horizontal"
                      label={`Actions pour ${row.name}`}
                      variant="ghost"
                      size="touch"
                      disabled={busy !== null}
                      onClick={() => setActions(row.slug)}
                    />
                  ) : (
                    status === 'online' && (
                      <IconButton
                        icon="download"
                        label={`Télécharger ${row.name}`}
                        variant="ghost"
                        size="touch"
                        disabled={busy !== null}
                        onClick={() => void prepare(row.slug)}
                      />
                    )
                  )}
                </div>

                {busy === row.slug && progress && <Progress progress={progress} />}
                {report?.slug === row.slug && <ReportNote report={report} />}
              </li>
            ))}
          </ul>
        </>
      )}

      <Sheet
        open={actionRow !== null}
        title={actionRow?.name ?? ''}
        onClose={() => setActions(null)}
      >
        <div className="sheet-nav">
          {actionRow?.resume && (
            <button
              type="button"
              className="sheet-nav-item"
              onClick={() => open(actionRow.slug)}
            >
              <Icon name="list" size={20} />
              <span className="sheet-nav-label">Ouvrir depuis le début</span>
            </button>
          )}
          {status === 'online' && actionRow && (
            <button
              type="button"
              className="sheet-nav-item"
              onClick={() => {
                setActions(null);
                void prepare(actionRow.slug);
              }}
            >
              <Icon name={actionRow.local ? 'refresh' : 'download'} size={20} />
              <span className="sheet-nav-label">
                {actionRow.local ? 'Resynchroniser' : 'Télécharger pour le hors-ligne'}
              </span>
            </button>
          )}
          {actionRow?.local && (
            <button
              type="button"
              className="sheet-nav-item picker-danger"
              onClick={() => void forget(actionRow.slug)}
            >
              <Icon name="trash" size={20} />
              <span className="sheet-nav-label">Supprimer du téléphone</span>
            </button>
          )}
        </div>
        {/* N'a de sens qu'en face du bouton rouge : une pièce jamais rapatriée n'a
            rien sur ce téléphone à effacer. */}
        {actionRow?.local && (
          <p className="picker-help">
            Supprimer n'efface que la copie de ce téléphone : la pièce reste sur le Mac, et se
            retélécharge quand tu veux.
          </p>
        )}
      </Sheet>

      <Sheet open={sheetOpen} title="Connexion" onClose={() => setSheetOpen(false)}>
        <p className="picker-sheet-state">
          {statusLabel(status, server)}
          {server && <span className="picker-sheet-base">{server.base}</span>}
        </p>

        <Button
          variant="primary"
          size="touch"
          icon="refresh"
          className="picker-sheet-search"
          onClick={() => void load()}
        >
          Rechercher le Mac
        </Button>

        <label className="picker-label" htmlFor="api-base">
          Adresse à distance (Tailscale)
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
            value={manual}
            onChange={(e) => setManual(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveManual();
            }}
          />
          <Button variant="neutral" size="touch" onClick={saveManual}>
            Enregistrer
          </Button>
        </div>
        <p className="picker-help">
          Sur le même réseau que le Mac, l'app le trouve toute seule. Cette adresse ne sert
          qu'à distance — mais elle reste prioritaire tant qu'elle est renseignée.
        </p>
        <p className="picker-help">
          Cherché sur le réseau : <code>{lanBase}</code>
        </p>
      </Sheet>
    </main>
  );
}

function Empty({
  status,
  onSearch,
  onSettings,
}: {
  status: Status;
  onSearch: () => void;
  onSettings: () => void;
}) {
  if (status === 'searching') return <p className="picker-hint">Recherche du Mac…</p>;
  if (status === 'online') return <p className="picker-hint">Aucune pièce sur le Mac.</p>;
  return (
    <div className="picker-empty">
      <p className="picker-empty-title">Aucune pièce sur ce téléphone</p>
      <p className="picker-empty-note">
        Allume le Mac et connecte-toi au même réseau : l'app le trouvera toute seule.
      </p>
      <Button variant="primary" size="touch" icon="refresh" onClick={onSearch}>
        Chercher le Mac
      </Button>
      <button type="button" className="picker-link" onClick={onSettings}>
        Saisir une adresse
      </button>
    </div>
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
        {progress.total ? `${progress.done} / ${progress.total}` : '…'}
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
      {ready} clip{ready > 1 ? 's' : ''} prêt{ready > 1 ? 's' : ''} hors-ligne.
      {report.missing > 0 && (
        <>
          {' '}
          {report.missing} manquant{report.missing > 1 ? 's' : ''} sur le Mac : ces répliques
          resteront muettes. Lance « 🎙️ Générer l'audio » dans l'atelier web, puis relance la
          synchronisation.
        </>
      )}
    </p>
  );
}

function statusLabel(status: Status, server: Instance | null): string {
  if (status === 'searching') return 'Recherche du Mac…';
  if (status === 'online') return `Connecté · ${server?.host || 'Mac'}`;
  return 'Hors ligne — appuie pour connecter';
}

/**
 * Assemblé à partir de ce qui est connu, sans trou : une copie préparée avant le
 * suivi des dates n'a pas de fraîcheur à annoncer, une pièce sans voix n'a ni clip
 * ni poids — dans les deux cas la ligne se raccourcit au lieu d'afficher un vide.
 */
function metaLabel(row: Row): string {
  if (!row.local) return 'Sur le Mac · pas téléchargée';
  const parts = ['Hors-ligne'];
  if (row.clips > 0) parts.push(`${row.clips} clips`);
  const size = formatBytes(row.bytes);
  if (size) parts.push(size);
  const age = formatAge(row.preparedAt);
  if (age) parts.push(`synchro ${age}`);
  return parts.join(' · ');
}

/**
 * Le point de reprise vit dans localStorage, écrit par le lecteur — il existe donc
 * dès qu'une pièce a été ouverte, téléchargée ou non.
 */
function resumeOf(slug: string): ResumePoint | undefined {
  return loadResume(storageKeyFor(slug));
}

async function localRows(): Promise<Row[]> {
  const local = await store.listLocalPlays();
  return Promise.all(
    local.map(async (play) => {
      const manifest = await store.loadManifest(play.slug);
      return {
        ...play,
        local: true,
        resume: resumeOf(play.slug),
        preparedAt: manifest?.preparedAt,
        bytes: await store.audioBytes(play.slug),
        // Dédoublonné par clé, comme le bilan de `prepareOffline` : deux répliques au
        // texte identique dites par la même voix partagent un seul fichier. Compter les
        // entrées du manifeste (une par réplique) afficherait un nombre plus élevé que
        // celui annoncé juste au-dessus par « N clips prêts hors-ligne ».
        clips: new Set(Object.values(manifest?.map ?? {})).size,
      };
    }),
  );
}

/**
 * Une pièce présente des deux côtés n'apparaît qu'une fois, et une pièce effacée du
 * Mac ne disparaît pas de la liste : elle est sur le téléphone, elle doit rester
 * ouvrable. Le nom vient du serveur, plus frais que la copie locale.
 */
function merge(local: Row[], served: { slug: string; name: string }[]): Row[] {
  const bySlug = new Map(local.map((row) => [row.slug, row]));
  const rows = served.map((play) => {
    const row = bySlug.get(play.slug);
    bySlug.delete(play.slug);
    return row
      ? { ...row, name: play.name }
      : { ...play, local: false, clips: 0, bytes: 0, resume: resumeOf(play.slug) };
  });
  return [...rows, ...bySlug.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Injecté par `main.ts` en même temps que `uiCss`, dont il consomme les jetons.
 *
 * Les tailles de texte sont en pixels et non en `--fs-*` : les jetons partagés
 * plafonnent à 19 px, calibrés pour l'atelier desktop, et donnent un écran
 * illisible à bout de bras. Même arbitrage que `reader-runtime/src/styles.ts`.
 * Le reste (couleurs, rayons, ombres, espacements) reste aux jetons.
 *
 * Les marges latérales viennent du `padding: 0 16px` du <body> (index.html) ; on
 * n'ajoute ici que les encoches du mode paysage.
 */
export const pickerCss = `
.picker {
  max-width: 560px;
  margin: 0 auto;
  padding-left: env(safe-area-inset-left);
  padding-right: env(safe-area-inset-right);
  padding-bottom: max(var(--sp-6), env(safe-area-inset-bottom));
  font-family: var(--font-ui);
  color: var(--ink);
}

/* ── En-tête ───────────────────────────────────────────────────────────────── */
.picker-head {
  padding-top: max(var(--sp-5), calc(env(safe-area-inset-top) + var(--sp-3)));
  padding-bottom: var(--sp-4);
}
.picker-title { font-size: 28px; font-weight: 700; letter-spacing: -.02em; margin: 0 0 var(--sp-3); }

.picker-status {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  width: 100%;
  min-height: var(--ctl-h-touch);
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  font-size: 15px;
  color: var(--ink-muted);
  text-align: left;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
}
.picker-status:active { opacity: .55; }
.picker-status-text { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.picker-status-chevron { flex: 0 0 auto; color: var(--ink-faint); }
.picker-dot { flex: 0 0 auto; width: 9px; height: 9px; border-radius: var(--r-full); background: var(--ink-faint); }
.picker-dot--online { background: var(--ok); }
.picker-dot--searching { background: var(--rule-strong); animation: picker-pulse 1.2s ease-in-out infinite; }
@keyframes picker-pulse { 50% { opacity: .3; } }
@media (prefers-reduced-motion: reduce) { .picker-dot--searching { animation: none; } }

/* ── Liste ─────────────────────────────────────────────────────────────────── */
.picker-list { list-style: none; margin: 0; padding: 0; }
.picker-row { border-top: 1px solid var(--rule); }
.picker-row:last-child { border-bottom: 1px solid var(--rule); }
.picker-row-main { display: flex; align-items: center; gap: var(--sp-2); }

/* Toute la rangée est la cible d'ouverture : sur téléphone, viser un lien de la
   taille d'un mot est une brimade. L'action secondaire garde ses 44 px à côté. */
.picker-open {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-height: 64px;
  justify-content: center;
  margin: 0;
  padding: var(--sp-3) var(--sp-2) var(--sp-3) 0;
  border: 0;
  background: none;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
}
.picker-open:active { background: var(--paper-sunken); }
.picker-open:focus-visible { outline: none; box-shadow: var(--focus-ring); border-radius: var(--r-sm); }
.picker-name {
  font-size: 17px;
  font-weight: 600;
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.picker-meta { font-size: 13px; color: var(--ink-muted); }
.picker-danger { color: var(--danger); }
/* En accent : c'est ce que fait le tap sur la rangée, pas une information de plus. */
.picker-resume {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-top: 2px;
  font-size: 13px;
  color: var(--accent);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── États ─────────────────────────────────────────────────────────────────── */
.picker-hint { font-size: 13px; color: var(--ink-muted); margin: 0 0 var(--sp-3); }
.picker-error { font-size: 15px; color: var(--danger); margin: 0 0 var(--sp-4); }
.picker-empty { padding: var(--sp-6) 0; text-align: center; }
.picker-empty-title { font-size: 17px; font-weight: 600; margin: 0 0 var(--sp-2); }
.picker-empty-note {
  font-size: 15px;
  color: var(--ink-muted);
  line-height: 1.45;
  margin: 0 auto var(--sp-5);
  max-width: 34ch;
}
.picker-link {
  display: block;
  margin: var(--sp-4) auto 0;
  min-height: var(--ctl-h-touch);
  padding: 0 var(--sp-3);
  border: 0;
  background: none;
  font: inherit;
  font-size: 15px;
  color: var(--ink-muted);
  text-decoration: underline;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

/* ── Progression & bilan ───────────────────────────────────────────────────── */
.picker-progress { display: flex; align-items: center; gap: var(--sp-3); padding-bottom: var(--sp-3); }
.picker-bar { flex: 1 1 auto; height: 4px; background: var(--paper-sunken); border-radius: var(--r-full); overflow: hidden; }
.picker-bar-fill { height: 100%; background: var(--accent); transition: width .2s linear; }
.picker-progress-text { font-size: 13px; color: var(--ink-muted); font-variant-numeric: tabular-nums; }
.picker-report { font-size: 13px; color: var(--ink-muted); margin: 0; padding-bottom: var(--sp-3); line-height: 1.45; }

/* ── Feuille « Connexion » ─────────────────────────────────────────────────── */
.picker-sheet-state { display: flex; flex-direction: column; gap: 2px; font-size: 15px; margin: 0 0 var(--sp-4); }
.picker-sheet-base { font-family: var(--font-mono); font-size: 13px; color: var(--ink-faint); overflow-wrap: anywhere; }
.picker-sheet-search { width: 100%; justify-content: center; margin-bottom: var(--sp-5); }
.picker-label {
  display: block;
  font-size: 12px;
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
  /* 16 px minimum, sinon iOS zoome sur le champ au focus et laisse la page décalée. */
  font-size: 16px;
  color: var(--ink);
  background: var(--paper-raised);
  border: 1px solid var(--rule-strong);
  border-radius: var(--r-md);
}
.picker-input:focus-visible { outline: none; box-shadow: var(--focus-ring); }
.picker-help { font-size: 13px; color: var(--ink-muted); line-height: 1.5; margin: var(--sp-3) 0 0; }
/* En bloc : à 12 px en mono, l'adresse ne tient pas sur la fin d'une ligne de
   texte et se ferait couper en plein milieu du token (« h / ttp:// »). */
.picker-help code { display: block; margin-top: 2px; font-family: var(--font-mono); font-size: 12px; overflow-wrap: anywhere; }
`;
