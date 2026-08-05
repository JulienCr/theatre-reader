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
  pruneOrphans,
  splitIntoPortions,
} from '@theatre/core';
import { Button } from '@theatre/ui';
import * as api from '../api';
import { loadReadingPrefs } from '../readingPrefs';
import { Check, DateField, NumberField, Row } from './controls';

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

const STATUS_LABEL: Record<string, string> = {
  ok: 'Dans les temps',
  tight: 'Tendu',
  late: 'Hors délai',
};

const STATUS_ADVICE: Record<string, string> = {
  ok: '',
  tight: 'Peu de marge : ne saute pas de séance cette semaine.',
  late: 'Il faut allonger les séances, ajouter des jours, ou reculer la date.',
};

const minutesOf = (cost: number): number => Math.round(cost / COST_PER_MINUTE);

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
  const saveChain = useRef<Promise<unknown>>(Promise.resolve());

  // Personnages qui parlent : proposer un rôle muet n'aurait aucun sens.
  const speakers = useMemo(() => {
    const ids = new Set(
      play.nodes.filter((n): n is LineNode => n.type === 'line').map((n) => n.characterId),
    );
    return play.characters.filter((c) => ids.has(c.id));
  }, [play]);

  /**
   * Rôles pré-cochés : d'abord ceux du mode répétition (ce que le comédien a
   * réellement coché dans le lecteur), sinon la case « moi » de la Distribution.
   * Lecture seule — ces réglages appartiennent à d'autres fonctionnalités.
   */
  const [draft, setDraft] = useState<StudyConfig>(() => {
    const fallback = audio.myCharacterId ? [audio.myCharacterId] : [];
    const { myRoles } = loadReadingPrefs(slug, fallback);
    return {
      roleIds: myRoles.length ? myRoles : fallback,
      target: addDays(isoDay(new Date()), 28),
      sessionMinutes: 25,
      daysPerWeek: 7,
    };
  });

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setLoadError(null);
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
  }, [slug]);

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

  const grade = (p: Portion, g: Grade): void => {
    if (state) persist(gradeNodes(state, p.nodeIds, g, today));
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
                  {fc.portionsLeft} portion{fc.portionsLeft > 1 ? 's' : ''} à découvrir ·{' '}
                  {fc.daysLeft} jour{fc.daysLeft > 1 ? 's' : ''} de travail restants
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
                {session.minutes > state.config.sessionMinutes + 1 && ' — journée de rattrapage'}.{' '}
                <button className="linklike" onClick={() => setEditing(true)}>
                  Reconfigurer
                </button>
              </p>
            </header>

            {session.orphans.length > 0 && (
              <p className="study-alert">
                {session.orphans.length} réplique{session.orphans.length > 1 ? 's' : ''} travaillée
                {session.orphans.length > 1 ? 's ont' : ' a'} changé ou disparu du texte.{' '}
                <button className="linklike" onClick={() => persist(pruneOrphans(state, portions))}>
                  Oublier
                </button>
              </p>
            )}

            {session.due.length === 0 && session.fresh.length === 0 && (
              <p className="study-done">
                Rien à travailler aujourd'hui. Le texte est en place, reviens demain.
              </p>
            )}

            <PortionList
              title="À réviser"
              portions={session.due}
              onOpen={onOpenPortion}
              onGrade={grade}
            />
            <PortionList
              title="Nouveau"
              portions={session.fresh}
              onOpen={onOpenPortion}
              onGrade={grade}
              empty={
                today > state.config.target
                  ? 'Date atteinte : entretien seul, plus de texte neuf.'
                  : undefined
              }
            />

            <section className="study-all">
              <button className="linklike" onClick={() => setShowAll((v) => !v)}>
                {showAll ? "Masquer l'avancement détaillé" : `Avancement des ${portions.length} portions`}
              </button>
              {showAll && (
                <ul className="study-progress">
                  {portions.map((p) => {
                    const st = portionState(p, state);
                    return (
                      <li key={p.id}>
                        <span className="study-progress__where">
                          {p.actLabel} {p.sceneLabel && `· ${p.sceneLabel}`} · tirades {p.fromTirade}
                          {p.toTirade !== p.fromTirade && `→${p.toTirade}`}
                        </span>
                        <span className="study-progress__level">
                          {st.seen === 0
                            ? 'jamais vue'
                            : st.seen < st.total
                              ? `${st.seen}/${st.total} répliques vues`
                              : `niveau ${st.level} · revoir le ${st.due}`}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
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
              <div className="study-portion__what">
                tirades {p.fromTirade}
                {p.toTirade !== p.fromTirade && `→${p.toTirade}`} · {p.words} mots · ~
                {minutesOf(p.cost)} min
                {p.shortLines > 0 && ` · ${p.shortLines} réplique${p.shortLines > 1 ? 's' : ''} courte${p.shortLines > 1 ? 's' : ''}`}
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

function StudyForm({
  draft,
  setDraft,
  speakers,
  today,
  preview,
  canCancel,
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
  const ready = draft.roleIds.length > 0 && dateValid && portions.length > 0;

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
          min={5}
          max={180}
          step={5}
          onChange={(sessionMinutes) => setDraft({ ...draft, sessionMinutes })}
        />
      </Row>
      <Row label="Jours par semaine">
        <NumberField
          value={draft.daysPerWeek}
          min={1}
          max={7}
          onChange={(daysPerWeek) => setDraft({ ...draft, daysPerWeek })}
        />
      </Row>

      <div className="study-preview">
        {portions.length === 0 ? (
          <p>Ce rôle n'a aucune réplique — rien à découper.</p>
        ) : (
          <>
            <p>
              <strong>{portions.length} portions</strong> · {Math.round(totalMinutes)} min de travail
              au total · {fc.daysLeft} jour{fc.daysLeft > 1 ? 's' : ''} de travail d'ici là
            </p>
            <p className={`study-status study-status--${fc.status}`}>
              {STATUS_LABEL[fc.status]}
              {STATUS_ADVICE[fc.status] && ` — ${STATUS_ADVICE[fc.status]}`}
            </p>
          </>
        )}
        {!dateValid && <p className="study-hint">Choisis une date postérieure à aujourd'hui.</p>}
      </div>

      <div className="study-form__actions">
        <Button variant="primary" disabled={!ready} onClick={onSubmit}>
          {canCancel ? 'Mettre à jour le plan' : 'Démarrer'}
        </Button>
        {canCancel && <Button onClick={onCancel}>Annuler</Button>}
      </div>
    </div>
  );
}
