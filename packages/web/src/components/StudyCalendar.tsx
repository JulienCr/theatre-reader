/**
 * Calendrier prévisionnel du plan d'apprentissage, et son export .ics.
 *
 * Ce que l'écran montre est une PRÉVISION recalculée à chaque ouverture, pas un
 * planning enregistré — c'est dit à l'utilisateur, parce que la différence se voit
 * le jour où il saute une séance et que les dates bougent.
 */

import { useMemo } from 'react';
import {
  DEFAULT_START_TIME,
  type PlannedDay,
  type Portion,
  type StudyConfig,
  buildStudyIcs,
  daysBetween,
  icsStamp,
  mergeTiradeRanges,
} from '@theatre/core';
import { Button } from '@theatre/ui';

/** « YYYY-MM-DD » → Date locale. Passer la chaîne à `new Date` la lirait en UTC. */
function localDate(day: string): Date {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

const DAY_FMT = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

/** « 2026-09-02 » → « mer. 2 sept. ». Une date ISO ne se lit pas d'un coup d'œil. */
export function formatDay(day: string): string {
  return DAY_FMT.format(localDate(day));
}

/** « 1→22, 40 » — une plage d'une seule tirade s'écrit sans flèche. */
function formatRanges(ranges: { from: number; to: number }[]): string {
  return ranges.map((r) => (r.from === r.to ? `${r.from}` : `${r.from}→${r.to}`)).join(', ');
}

/** Numéro de semaine relatif, pour grouper les jours sans afficher de dates ISO. */
function weekIndex(day: string, first: string): number {
  return Math.floor(daysBetween(first, day) / 7);
}

/**
 * Un bloc de travail : ce qu'on fait, de quelle tirade à quelle tirade, avec le
 * texte de chaque borne.
 *
 * Le numéro seul ne dit rien à un comédien, et le texte seul ne dit pas où l'on
 * est : les deux vont ensemble, sur chaque borne. Une seule ligne quand le bloc
 * tient en une réplique — répéter le même texte sous « de » et « à » ne borne rien.
 */
export function WorkBlock({ label, portions }: { label?: string; portions: Portion[] }) {
  if (!portions.length) return null;
  // `due` arrive trié par retard : il faut l'ordre du texte pour parler de bornes.
  const sorted = [...portions].sort((a, b) => a.fromTirade - b.fromTirade);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const ranges = mergeTiradeRanges(sorted);
  const single = first.fromTirade === last.toTirade;

  return (
    <div className="study-block">
      <div className="study-block__head">
        {label && <span className="study-block__label">{label}</span>}
        <span className="study-block__range">
          {single ? `tirade ${first.fromTirade}` : `tirades ${formatRanges(ranges)}`}
        </span>
        {ranges.length > 1 && (
          /* Sans ça, les deux citations laisseraient croire à une plage continue
             alors que le milieu n'est pas au programme du jour. */
          <span className="study-block__gaps">
            ({ranges.length} morceaux, {portions.reduce((s, p) => s + p.lines, 0)} tirades)
          </span>
        )}
      </div>
      <div className="study-block__quotes">
        <span className="study-block__text">« {first.preview} »</span>
        {!single && (
          <>
            <span className="study-block__arrow" aria-hidden="true">
              →
            </span>
            <span className="study-block__text">« {last.previewEnd} »</span>
          </>
        )}
      </div>
    </div>
  );
}

export function StudyCalendar({
  days,
  config,
  roleName,
  playTitle,
  slug,
  onError,
}: {
  days: PlannedDay[];
  config: StudyConfig;
  roleName: string;
  playTitle: string;
  slug: string;
  onError: (message: string) => void;
}) {
  const weeks = useMemo(() => {
    if (!days.length) return [];
    const first = days[0]!.day;
    const out: { index: number; days: PlannedDay[] }[] = [];
    for (const d of days) {
      const i = weekIndex(d.day, first);
      const last = out[out.length - 1];
      if (last && last.index === i) last.days.push(d);
      else out.push({ index: i, days: [d] });
    }
    return out;
  }, [days]);

  if (!days.length) {
    return (
      <p className="study-empty">
        Rien à projeter : la date d'atterrissage est passée, ou tout est déjà su.
      </p>
    );
  }

  const startTime = config.startTime ?? DEFAULT_START_TIME;
  const totalMinutes = days.reduce((s, d) => s + d.minutes, 0);
  /**
   * La moyenne réellement projetée, à comparer à la durée demandée. C'est la
   * mesure la plus honnête dont dispose l'écran : le statut d'atterrissage, lui,
   * raisonne sur le seul texte neuf et ignore ce que coûteront les révisions.
   */
  const averageMinutes = totalMinutes / days.length;
  const overruns = days.filter((d) => d.minutes > config.sessionMinutes + 1).length;

  const exportIcs = (): void => {
    const ics = buildStudyIcs(days, {
      roleName,
      playTitle,
      startTime,
      minutes: config.sessionMinutes,
      stamp: icsStamp(new Date()),
      uidPrefix: `${slug}-${config.roleIds.join('-')}`,
    });
    if (!ics) {
      onError("Rien à exporter dans ce calendrier.");
      return;
    }
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug}-${roleName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.ics`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="study-calendar">
      <div className="study-calendar__head">
        <p className="study-calendar__figures">
          <strong>{days.length} séances</strong> d'ici le{' '}
          {DAY_FMT.format(localDate(config.target))} · {Math.round(totalMinutes / 60)} h au total ·
          à partir de {startTime}
        </p>
        <Button variant="primary" onClick={exportIcs}>
          Exporter vers mon agenda
        </Button>
      </div>

      {overruns > 0 && (
        <p className="study-alert">
          À ce rythme, {overruns} séance{overruns > 1 ? 's' : ''} sur {days.length} dépasse
          {overruns > 1 ? 'nt' : ''} les {config.sessionMinutes} min demandées —{' '}
          <strong>{Math.round(averageMinutes)} min en moyenne</strong>, révisions comprises.
          Allonge les séances ou recule la date si ce n'est pas tenable.
        </p>
      )}

      <p className="study-hint">
        Les tirades « à revoir » sont celles des jours précédents : une fois apprises,
        elles reviennent le lendemain, puis à 3, 7, 14 jours — c'est cet espacement qui
        les fait tenir. Prévision et non planning : elle suppose qu'un passage sur trois
        demandera une reprise, et se recale chaque jour selon ce que tu notes. Le fichier
        exporté, lui, fige ces dates — si tu décroches, ré-exporte.
      </p>

      {weeks.map((w) => (
        <div key={w.index} className="study-week">
          <h3 className="study-week__title">Semaine {w.index + 1}</h3>
          <ol className="study-days">
            {w.days.map((d) => (
              <li
                key={d.day}
                className={`study-day${d.minutes > config.sessionMinutes + 1 ? ' study-day--over' : ''}`}
              >
                {/* Date et durée sur leur propre ligne : les mettre en colonnes de
                    part et d'autre du contenu obligeait l'œil à suivre six
                    alignements verticaux par jour. */}
                <div className="study-day__head">
                  <span className="study-day__date">{DAY_FMT.format(localDate(d.day))}</span>
                  <span className="study-day__time">~{Math.round(d.minutes)} min</span>
                </div>
                <WorkBlock label="apprendre" portions={d.fresh} />
                <WorkBlock label="revoir" portions={d.due} />
              </li>
            ))}
          </ol>
        </div>
      ))}
    </section>
  );
}
