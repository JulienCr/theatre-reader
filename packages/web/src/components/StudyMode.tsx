/**
 * Mode Apprentissage : configuration du plan, puis séance du jour.
 *
 * Aucun calendrier n'est stocké — la séance est recalculée à chaque ouverture à
 * partir de l'avancement et de la date d'atterrissage (cf. `@theatre/core/study`).
 * L'écran ne réimplémente aucune règle du moteur : il affiche ce que
 * `planSession` / `forecast` lui rendent, et n'y ajoute que les phrases.
 *
 * `today` est figé au montage : recalculer la date à chaque rendu ferait changer
 * la séance sous les doigts de l'utilisateur au passage de minuit.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  COST_PER_MINUTE,
  DAYS_PER_WEEK_MAX,
  DAYS_PER_WEEK_MIN,
  DEFAULT_START_TIME,
  SESSION_MINUTES_MAX,
  SESSION_MINUTES_MIN,
  type AudioConfig,
  type Grade,
  type LineNode,
  type Play,
  type Portion,
  type StudyConfig,
  type StudyState,
  addDays,
  budgetForSession,
  daysBetween,
  forecast,
  gradeNodes,
  isoDay,
  newStudyState,
  planSession,
  portionState,
  projectSchedule,
  pruneOrphans,
  splitIntoPortions,
} from '@theatre/core';
import { Button } from '@theatre/ui';
import * as api from '../api';
import { loadReadingPrefs } from '../readingPrefs';
import { Check, DateField, NumberField, Row, TimeField } from './controls';
import { StudyCalendar, WorkBlock, formatDay } from './StudyCalendar';
import { Segmented } from './ui/Segmented';

export interface StudyModeProps {
  slug: string;
  /** AST déjà mémoïsé par `App` — ne pas re-parser ici. */
  play: Play;
  audio: AudioConfig;
  /** Ouvre le lecteur sur une réplique (ancrage `data-nid`, cf. NavTarget). */
  onOpenPortion: (nodeId: string) => void;
  /** Renvoie vers la Distribution quand aucun rôle n'est défini. */
  onOpenCast: () => void;
  onError: (message: string) => void;
}

/**
 * Typés sur l'union réelle des statuts, et non sur `Record<string, string>` :
 * ajouter un statut au moteur casse alors la compilation ici, au lieu d'afficher
 * un `undefined` que rien ne signale.
 */
type Status = ReturnType<typeof forecast>['status'];

const STATUS_LABEL: Record<Status, string> = {
  ok: 'Dans les temps',
  tight: 'Tendu',
  late: 'Hors délai',
};

const STATUS_ADVICE: Record<Status, string> = {
  ok: '',
  tight: 'Peu de marge : ne saute pas de séance cette semaine.',
  late: 'Il faut allonger les séances, ajouter des jours, ou reculer la date.',
};

const minutesOf = (cost: number): number => Math.round(cost / COST_PER_MINUTE);

const GRADE_LABEL: Record<Grade, string> = {
  again: 'Pas su',
  hard: 'Hésitant',
  good: 'Su',
};

type StudyView = 'session' | 'calendar';

const VIEWS: { value: StudyView; label: string }[] = [
  { value: 'session', label: 'Séance du jour' },
  { value: 'calendar', label: 'Calendrier' },
];

/**
 * Configuration proposée pour une pièce sans plan : rôles pris d'abord du mode
 * répétition (ce que le comédien a réellement coché dans le lecteur), sinon de la
 * case « moi » de la Distribution. Lecture seule — ces réglages appartiennent à
 * d'autres fonctionnalités.
 */
function defaultDraft(slug: string, audio: AudioConfig): StudyConfig {
  const fallback = audio.myCharacterId ? [audio.myCharacterId] : [];
  const { myRoles } = loadReadingPrefs(slug, fallback);
  return {
    roleIds: myRoles.length ? myRoles : fallback,
    target: addDays(isoDay(new Date()), 28),
    sessionMinutes: 25,
    daysPerWeek: 7,
    startTime: DEFAULT_START_TIME,
  };
}

export function StudyMode({
  slug,
  play,
  audio,
  onOpenPortion,
  onOpenCast,
  onError,
}: StudyModeProps) {
  const [today] = useState(() => isoDay(new Date()));
  const [state, setState] = useState<StudyState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [view, setView] = useState<StudyView>('session');
  /**
   * État d'avant la dernière note, pour se rétracter. Un seul cran : au-delà, la
   * liste d'avancement permet de re-noter n'importe quelle portion, ce qui couvre
   * le cas « je croyais la savoir » mieux qu'une pile d'annulations.
   */
  const [undo, setUndo] = useState<{ state: StudyState; label: string } | null>(null);
  const saveChain = useRef<Promise<unknown>>(Promise.resolve());

  // Personnages qui parlent : proposer un rôle muet n'aurait aucun sens.
  const speakers = useMemo(() => {
    const ids = new Set(
      play.nodes.filter((n): n is LineNode => n.type === 'line').map((n) => n.characterId),
    );
    return play.characters.filter((c) => ids.has(c.id));
  }, [play]);

  const [draft, setDraft] = useState<StudyConfig>(() => defaultDraft(slug, audio));

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setLoadError(null);
    // Tout ce qui décrit la pièce PRÉCÉDENTE est jeté avant de charger la
    // suivante. Sans cela, un GET en échec (500, hors ligne) laissait le plan de
    // l'ancienne pièce à l'écran — et une note l'aurait écrit dans la nouvelle.
    setState(null);
    setUndo(null);
    setEditing(false);
    setDraft(defaultDraft(slug, audio));
    api
      .loadStudy(slug)
      .then((s) => {
        if (cancelled) return;
        setState(s);
        if (s) setDraft(s.config);
        setEditing(!s);
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [slug, audio]);

  const persist = (next: StudyState): void => {
    setState(next);
    // Sérialisé : deux évaluations rapprochées ne doivent pas s'écrire dans le désordre.
    saveChain.current = saveChain.current
      .then(() => api.saveStudy(slug, next))
      .catch((e: unknown) => onError(String(e)));
  };

  // ---- Aperçu du brouillon (configuration) ----
  const preview = useMemo(() => {
    const portions = splitIntoPortions(play, draft.roleIds, budgetForSession(draft.sessionMinutes));
    const probe: StudyState = { version: 1, config: draft, progress: state?.progress ?? {} };
    return { portions, fc: forecast(portions, probe, today) };
  }, [play, draft, state, today]);

  // ---- Séance du jour ----
  const portions = useMemo(
    () =>
      state
        ? splitIntoPortions(play, state.config.roleIds, budgetForSession(state.config.sessionMinutes))
        : [],
    [play, state],
  );
  const session = useMemo(
    () => (state ? planSession(portions, state, today) : null),
    [portions, state, today],
  );
  const fc = useMemo(
    () => (state ? forecast(portions, state, today) : null),
    [portions, state, today],
  );

  const schedule = useMemo(
    () => (state ? projectSchedule(portions, state, today) : []),
    [portions, state, today],
  );

  /** Tirades encore jamais travaillées — l'unité que compte un comédien. */
  const tiradesLeft = useMemo(
    () =>
      state
        ? portions.filter((p) => portionState(p, state).seen === 0).reduce((s, p) => s + p.lines, 0)
        : 0,
    [portions, state],
  );

  /** Charge moyenne réellement projetée, si elle dépasse la durée demandée. */
  const projectedLoad = useMemo(() => {
    if (!state || !schedule.length) return null;
    const avg = schedule.reduce((s, d) => s + d.minutes, 0) / schedule.length;
    return avg > state.config.sessionMinutes + 1 ? Math.round(avg) : null;
  }, [schedule, state]);

  const roleNames = useMemo(() => {
    const ids = state?.config.roleIds ?? [];
    return (
      play.characters
        .filter((c) => ids.includes(c.id))
        .map((c) => c.canonicalName)
        .join(', ') || 'Mon rôle'
    );
  }, [play.characters, state?.config.roleIds]);

  const resetProgress = (): void => {
    if (!state) return;
    setUndo({ state, label: 'Progression effacée' });
    persist({ ...state, progress: {} });
  };

  const deletePlan = (): void => {
    setUndo(null);
    // Après les écritures en attente : un PUT en vol recréerait le fichier.
    saveChain.current = saveChain.current
      .then(() => api.deleteStudy(slug))
      .then(() => {
        setState(null);
        setEditing(true);
      })
      .catch((e: unknown) => onError(String(e)));
  };

  /**
   * Ouvre la portion dans le lecteur, en prévenant si elle risque d'y être
   * invisible : « mes scènes seulement » filtre sur les rôles du LECTEUR, qui ne
   * sont pas forcément ceux du plan. La cible sortirait alors du DOM et le saut
   * n'irait nulle part, sans rien dire.
   */
  const openPortion = (nodeId: string): void => {
    const planned = state?.config.roleIds ?? [];
    const prefs = loadReadingPrefs(slug, audio.myCharacterId ? [audio.myCharacterId] : []);
    if (prefs.settings.onlyMyScenes && !planned.every((r) => prefs.myRoles.includes(r))) {
      onError(
        "Le lecteur n'affiche que tes scènes, pour un rôle différent du plan : le passage peut y être masqué.",
      );
    }
    onOpenPortion(nodeId);
  };

  const grade = (p: Portion, g: Grade): void => {
    if (!state) return;
    const range = p.toTirade === p.fromTirade ? `${p.fromTirade}` : `${p.fromTirade}→${p.toTirade}`;
    setUndo({ state, label: `« ${GRADE_LABEL[g]} » sur les tirades ${range}` });
    persist(gradeNodes(state, p.nodeIds, g, today));
  };

  if (!loaded) return <div className="empty">Chargement du plan…</div>;

  if (!speakers.length) {
    return (
      <div className="empty">
        <div>
          <h2>Aucune réplique dans cette pièce</h2>
          <p>Il n'y a rien à apprendre tant que le texte ne contient pas de personnages.</p>
        </div>
      </div>
    );
  }

  const showForm = editing || !state;

  return (
    <div className="study">
      {loadError && (
        <p className="study-alert">
          Le plan n'a pas pu être chargé ({loadError}). Reconfigurer écrasera le fichier existant.
        </p>
      )}

      {showForm ? (
        <StudyForm
          draft={draft}
          setDraft={setDraft}
          speakers={speakers.map((c) => ({ id: c.id, name: c.canonicalName }))}
          today={today}
          preview={preview}
          canCancel={Boolean(state)}
          hasProgress={Boolean(state && Object.keys(state.progress).length)}
          onResetProgress={resetProgress}
          onDeletePlan={deletePlan}
          onCancel={() => setEditing(false)}
          onSubmit={() => {
            // La progression survit à une reconfiguration : elle est indexée par
            // nodeId, pas par portion — c'est tout l'intérêt de cet ancrage.
            persist(state ? { ...state, config: draft } : newStudyState(draft));
            setEditing(false);
          }}
          onOpenCast={onOpenCast}
        />
      ) : (
        session &&
        fc &&
        state && (
          <>
            <header className="study-head">
              <div className="study-head__figures">
                <strong className="study-countdown">
                  {daysBetween(today, state.config.target) >= 0
                    ? `J-${daysBetween(today, state.config.target)}`
                    : 'Date atteinte'}
                </strong>
                <span className={`study-status study-status--${fc.status}`}>
                  {STATUS_LABEL[fc.status]}
                </span>
                <span className="study-head__detail">
                  {/* En tirades : le découpage en portions est un détail du moteur. */}
                  {tiradesLeft} tirade{tiradesLeft > 1 ? 's' : ''} à découvrir · {fc.daysLeft}{' '}
                  jour{fc.daysLeft > 1 ? 's' : ''} de travail restants
                </span>
              </div>
              <progress
                className="progress-bar"
                value={portions.length - fc.portionsLeft}
                max={portions.length}
              />
              {STATUS_ADVICE[fc.status] && (
                <p className="study-advice">{STATUS_ADVICE[fc.status]}</p>
              )}
              <p className="study-head__load">
                Séance d'environ {Math.round(session.minutes)} min
                {session.minutes > state.config.sessionMinutes + 1 && ' — journée de rattrapage'}.
                {/* Le statut ci-dessus ne répond qu'à « reste-t-il assez de jours pour
                    tout découvrir ». La charge, révisions comprises, ne se mesure que
                    par simulation : quand elle dépasse la durée demandée, le dire ici
                    évite un « tendu » rassurant au-dessus d'un plan intenable. */}
                {projectedLoad !== null && (
                  <>
                    {' '}
                    D'ici le {formatDay(state.config.target)}, compte plutôt{' '}
                    <strong>{projectedLoad} min par séance</strong>.
                  </>
                )}{' '}
                <button className="linklike" onClick={() => setEditing(true)}>
                  Reconfigurer
                </button>
              </p>
              <Segmented value={view} options={VIEWS} onChange={setView} label="Vue" />
            </header>

            {undo && (
              <p className="study-undo">
                {undo.label}.{' '}
                <button
                  className="linklike"
                  onClick={() => {
                    persist(undo.state);
                    setUndo(null);
                  }}
                >
                  Annuler
                </button>
              </p>
            )}

            {session.orphans.length > 0 && (
              <p className="study-alert">
                {session.orphans.length} réplique{session.orphans.length > 1 ? 's' : ''} travaillée
                {session.orphans.length > 1 ? 's ont' : ' a'} changé ou disparu du texte.{' '}
                <button className="linklike" onClick={() => persist(pruneOrphans(state, portions))}>
                  Oublier
                </button>
              </p>
            )}

            {view === 'calendar' ? (
              <StudyCalendar
                days={schedule}
                config={state.config}
                roleName={roleNames}
                playTitle={play.title ?? 'Pièce'}
                slug={slug}
                onError={onError}
              />
            ) : (
              <>
                {session.due.length === 0 && session.fresh.length === 0 && (
                  <p className="study-done">
                    Rien à travailler aujourd'hui. Le texte est en place, reviens demain.
                  </p>
                )}

                <PortionList
                  title="À réviser"
                  portions={session.due}
                  onOpen={openPortion}
                  onGrade={grade}
                />
                <PortionList
                  title="Nouveau"
                  portions={session.fresh}
                  onOpen={openPortion}
                  onGrade={grade}
                  empty={
                    today > state.config.target
                      ? 'Date atteinte : entretien seul, plus de texte neuf.'
                      : undefined
                  }
                />

                <section className="study-all">
                  <button className="linklike" onClick={() => setShowAll((v) => !v)}>
                    {showAll ? "Masquer l'avancement détaillé" : 'Avancement détaillé'}
                  </button>
                  {showAll && (
                    <ul className="study-progress">
                      {portions.map((p) => {
                        const st = portionState(p, state);
                        return (
                          <li key={p.id}>
                            <span className="study-progress__where">
                              {p.actLabel} {p.sceneLabel && `· ${p.sceneLabel}`} · tirades{' '}
                              {p.fromTirade}
                              {p.toTirade !== p.fromTirade && `→${p.toTirade}`}
                            </span>
                            <span className="study-progress__level">
                              {st.seen === 0
                                ? 'jamais vue'
                                : st.seen < st.total
                                  ? `${st.seen}/${st.total} répliques vues`
                                  : `niveau ${st.level} · revoir le ${st.due}`}
                            </span>
                            {/* Re-noter ici : c'est le seul endroit où atteindre une
                                portion déjà sortie de la séance du jour. */}
                            <span className="study-grades">
                              {(['again', 'hard', 'good'] as const).map((g) => (
                                <Button
                                  key={g}
                                  size="sm"
                                  className={`grade grade--${g}`}
                                  onClick={() => grade(p, g)}
                                >
                                  {GRADE_LABEL[g]}
                                </Button>
                              ))}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              </>
            )}
          </>
        )
      )}
    </div>
  );
}

function PortionList({
  title,
  portions,
  onOpen,
  onGrade,
  empty,
}: {
  title: string;
  portions: Portion[];
  onOpen: (nodeId: string) => void;
  onGrade: (p: Portion, g: Grade) => void;
  empty?: string;
}) {
  if (!portions.length) return empty ? <p className="study-empty">{empty}</p> : null;
  return (
    <section className="study-section">
      <h2>
        {title} <span className="study-section__count">{portions.length}</span>
      </h2>
      <ul className="study-portions">
        {portions.map((p) => (
          <li key={p.id} className="study-portion">
            <div className="study-portion__text">
              <div className="study-portion__where">
                {p.actLabel}
                {p.sceneLabel && ` · ${p.sceneLabel}`}
              </div>
              {/* Les numéros de tirades sont portés par les bornes ci-dessus :
                  les répéter ici ferait lire deux fois la même information. */}
              <WorkBlock portions={[p]} />
              <div className="study-portion__what">
                {p.lines} tirade{p.lines > 1 ? 's' : ''} · {p.words} mots · ~{minutesOf(p.cost)} min
                {p.shortLines > 0 && ` · ${p.shortLines} courte${p.shortLines > 1 ? 's' : ''}`}
              </div>
            </div>
            <Button size="sm" variant="ghost" onClick={() => onOpen(p.nodeIds[0]!)}>
              Ouvrir
            </Button>
            {/* Les trois notes restent neutres : l'accent est réservé à l'unique
                action primaire d'un écran, et « pas su » n'est pas destructif —
                elles se distinguent par un liseré, pas par un aplat. */}
            <div className="study-grades">
              <Button size="sm" className="grade grade--again" onClick={() => onGrade(p, 'again')}>
                Pas su
              </Button>
              <Button size="sm" className="grade grade--hard" onClick={() => onGrade(p, 'hard')}>
                Hésitant
              </Button>
              <Button size="sm" className="grade grade--good" onClick={() => onGrade(p, 'good')}>
                Su
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Action destructive en deux temps. Pas de dialogue : le bouton s'arme, et se
 * désarme si on l'ignore. Les jetons veulent une action destructive en texte, sur
 * `--danger`, jamais en aplat — d'où la forme de lien plutôt que de bouton plein.
 */
function DangerAction({ label, question, onConfirm }: {
  label: string;
  question: string;
  onConfirm: () => void;
}) {
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return (
      <button className="linklike linklike--danger" onClick={() => setArmed(true)}>
        {label}
      </button>
    );
  }
  return (
    <span className="study-danger">
      {question}
      <button
        className="linklike linklike--danger"
        onClick={() => {
          setArmed(false);
          onConfirm();
        }}
      >
        Confirmer
      </button>
      <button className="linklike" onClick={() => setArmed(false)}>
        Non
      </button>
    </span>
  );
}

function StudyForm({
  draft,
  setDraft,
  speakers,
  today,
  preview,
  canCancel,
  hasProgress,
  onResetProgress,
  onDeletePlan,
  onCancel,
  onSubmit,
  onOpenCast,
}: {
  draft: StudyConfig;
  setDraft: (c: StudyConfig) => void;
  speakers: { id: string; name: string }[];
  today: string;
  preview: { portions: Portion[]; fc: ReturnType<typeof forecast> };
  canCancel: boolean;
  hasProgress: boolean;
  onResetProgress: () => void;
  onDeletePlan: () => void;
  onCancel: () => void;
  onSubmit: () => void;
  onOpenCast: () => void;
}) {
  const { portions, fc } = preview;
  const toggleRole = (id: string): void => {
    const has = draft.roleIds.includes(id);
    setDraft({
      ...draft,
      roleIds: has ? draft.roleIds.filter((r) => r !== id) : [...draft.roleIds, id],
    });
  };

  const totalMinutes = portions.reduce((s, p) => s + p.cost, 0) / COST_PER_MINUTE;
  const dateValid = daysBetween(today, draft.target) > 0;
  /**
   * Les bornes des champs numériques comptent dans la validité : `NumberField`
   * rend 0 pour un champ vidé et laisse taper hors bornes. Sans ce contrôle, on
   * quittait l'édition sur un état que `parseStudyState` refuse côté serveur —
   * l'écran affichait alors une séance calculée depuis un plan jamais enregistré,
   * qui disparaissait au rechargement.
   */
  const minutesValid =
    Number.isFinite(draft.sessionMinutes) &&
    draft.sessionMinutes >= SESSION_MINUTES_MIN &&
    draft.sessionMinutes <= SESSION_MINUTES_MAX;
  const daysValid =
    Number.isInteger(draft.daysPerWeek) &&
    draft.daysPerWeek >= DAYS_PER_WEEK_MIN &&
    draft.daysPerWeek <= DAYS_PER_WEEK_MAX;
  const ready =
    draft.roleIds.length > 0 && dateValid && minutesValid && daysValid && portions.length > 0;

  return (
    <div className="study-form">
      <h2>Plan d'apprentissage</h2>

      <fieldset className="study-roles">
        <legend>Rôle{draft.roleIds.length > 1 ? 's' : ''} à apprendre</legend>
        {speakers.map((c) => (
          <Check
            key={c.id}
            label={c.name}
            checked={draft.roleIds.includes(c.id)}
            onChange={() => toggleRole(c.id)}
          />
        ))}
        {!draft.roleIds.length && (
          <p className="study-hint">
            Coche le rôle que tu joues, ou renseigne-le une fois pour toutes dans la{' '}
            <button className="linklike" onClick={onOpenCast}>
              Distribution
            </button>
            .
          </p>
        )}
      </fieldset>

      <Row label="Texte su le">
        <DateField
          value={draft.target}
          min={addDays(today, 1)}
          onChange={(target) => setDraft({ ...draft, target })}
          aria-label="Date d'atterrissage"
        />
      </Row>
      <Row label="Minutes par séance">
        <NumberField
          value={draft.sessionMinutes}
          min={SESSION_MINUTES_MIN}
          max={SESSION_MINUTES_MAX}
          step={5}
          onChange={(sessionMinutes) => setDraft({ ...draft, sessionMinutes })}
        />
      </Row>
      <Row label="Jours par semaine">
        <NumberField
          value={draft.daysPerWeek}
          min={DAYS_PER_WEEK_MIN}
          max={DAYS_PER_WEEK_MAX}
          onChange={(daysPerWeek) => setDraft({ ...draft, daysPerWeek })}
        />
      </Row>
      <Row label="Heure de séance">
        <TimeField
          value={draft.startTime ?? DEFAULT_START_TIME}
          onChange={(startTime) => setDraft({ ...draft, startTime })}
          aria-label="Heure de début des séances, pour l'export vers l'agenda"
        />
      </Row>

      <div className="study-preview">
        {portions.length === 0 ? (
          <p>Ce rôle n'a aucune réplique — rien à découper.</p>
        ) : (
          <>
            <p>
              <strong>{portions.reduce((s, p) => s + p.lines, 0)} tirades</strong> ·{' '}
              {Math.round(totalMinutes)} min de travail au total · {fc.daysLeft} jour
              {fc.daysLeft > 1 ? 's' : ''} de travail d'ici là
            </p>
            <p className={`study-status study-status--${fc.status}`}>
              {STATUS_LABEL[fc.status]}
              {STATUS_ADVICE[fc.status] && ` — ${STATUS_ADVICE[fc.status]}`}
            </p>
          </>
        )}
        {!dateValid && <p className="study-hint">Choisis une date postérieure à aujourd'hui.</p>}
        {!minutesValid && (
          <p className="study-hint">
            Une séance dure entre {SESSION_MINUTES_MIN} et {SESSION_MINUTES_MAX} minutes.
          </p>
        )}
        {!daysValid && (
          <p className="study-hint">
            Entre {DAYS_PER_WEEK_MIN} et {DAYS_PER_WEEK_MAX} jours par semaine.
          </p>
        )}
      </div>

      <div className="study-form__actions">
        <Button variant="primary" disabled={!ready} onClick={onSubmit}>
          {canCancel ? 'Mettre à jour le plan' : 'Démarrer'}
        </Button>
        {canCancel && <Button onClick={onCancel}>Annuler</Button>}
      </div>

      {canCancel && (
        <div className="study-reset">
          <p className="study-hint">
            Changer la date ou la durée ci-dessus <strong>conserve</strong> ta progression —
            elle est ancrée sur les répliques, pas sur le découpage. Pour repartir de zéro :
          </p>
          {hasProgress && (
            <DangerAction
              label="Effacer ma progression"
              question="Tout ce qui est su redevient à apprendre. "
              onConfirm={onResetProgress}
            />
          )}
          <DangerAction
            label="Supprimer le plan"
            question="Le plan et sa progression disparaissent. "
            onConfirm={onDeletePlan}
          />
        </div>
      )}
    </div>
  );
}
