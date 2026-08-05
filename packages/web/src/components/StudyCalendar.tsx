/**
 * Calendrier prévisionnel du plan d'apprentissage, et son export .ics.
 *
 * Une grille de mois, pas une liste : cet écran répond à « est-ce que ça tient,
 * à quoi ressemble mon mois, où sont les jours impossibles » — une question de
 * forme, qu'on lit d'un coup d'œil. Le détail d'un jour (tirades et extraits)
 * s'ouvre à la demande ; l'afficher partout noierait la réponse sous 58 citations
 * de journées hypothétiques. Les extraits gardent leur place dans la séance du
 * jour, là où il s'agit de reconnaître le passage qu'on va travailler.
 *
 * Ce que la grille montre est une PRÉVISION recalculée à chaque ouverture, pas un
 * planning enregistré — la différence se voit le jour où l'on saute une séance et
 * que les dates bougent.
 */

import { useMemo, useState } from 'react';
import {
  DEFAULT_START_TIME,
  type PlannedDay,
  type Portion,
  type StudyConfig,
  buildStudyIcs,
  icsStamp,
  isoDay,
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
const MONTH_FMT = new Intl.DateTimeFormat('fr-FR', { month: 'short' });

/** « 2026-09-02 » → « mer. 2 sept. ». Une date ISO ne se lit pas d'un coup d'œil. */
export function formatDay(day: string): string {
  return DAY_FMT.format(localDate(day));
}

/** « 1→22, 40 » — une plage d'une seule tirade s'écrit sans flèche. */
function formatRanges(ranges: { from: number; to: number }[]): string {
  return ranges.map((r) => (r.from === r.to ? `${r.from}` : `${r.from}→${r.to}`)).join(', ');
}

const WEEKDAYS = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'];

/**
 * Semaines calendaires du lundi au dimanche, cases vides comprises. Aligner sur
 * de vrais jours de semaine est tout l'intérêt d'une grille : c'est ce qui fait
 * voir « tous mes samedis sont chargés ».
 */
function buildWeeks(days: PlannedDay[]): (PlannedDay | null)[][] {
  if (!days.length) return [];
  const byDay = new Map(days.map((d) => [d.day, d]));
  const first = localDate(days[0]!.day);
  const lastDay = days[days.length - 1]!.day;

  const cursor = new Date(first);
  cursor.setDate(cursor.getDate() - ((cursor.getDay() + 6) % 7)); // reculer au lundi

  const weeks: (PlannedDay | null)[][] = [];
  let guard = 0;
  while (guard++ < 60) {
    const week: (PlannedDay | null)[] = [];
    let reachedEnd = false;
    for (let i = 0; i < 7; i++) {
      const iso = isoDay(cursor);
      week.push(byDay.get(iso) ?? null);
      if (iso >= lastDay) reachedEnd = true;
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
    if (reachedEnd) break;
  }
  return weeks;
}

/**
 * Un bloc de travail : ce qu'on fait, de quelle tirade à quelle tirade, avec le
 * texte de chaque borne. Le numéro seul ne dit rien à un comédien, le texte seul
 * ne dit pas où l'on est : les deux vont ensemble.
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
  const [selected, setSelected] = useState<string | null>(null);
  const weeks = useMemo(() => buildWeeks(days), [days]);
  /**
   * Premier jour TRAVAILLÉ de chaque mois — et non le 1er du mois, qui tombe
   * souvent un jour de repos : sans ça, on passe du 30 août au 2 septembre sans
   * rien qui signale le changement de mois.
   */
  const monthMarks = useMemo(() => {
    const seen = new Set<string>();
    const marks = new Set<string>();
    for (const d of days) {
      const month = d.day.slice(0, 7);
      if (!seen.has(month)) {
        seen.add(month);
        marks.add(d.day);
      }
    }
    return marks;
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
  const averageMinutes = totalMinutes / days.length;
  const overruns = days.filter((d) => d.minutes > config.sessionMinutes + 1).length;
  /* Échelle des barres : le jour le plus chargé remplit la case. Une échelle
     absolue en minutes écraserait tout quand une seule journée explose. */
  const peak = Math.max(...days.map((d) => d.minutes));
  const selectedDay = days.find((d) => d.day === selected) ?? null;

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
      onError('Rien à exporter dans ce calendrier.');
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
          <strong>{days.length} séances</strong> d'ici le {formatDay(config.target)} ·{' '}
          {Math.round(totalMinutes / 60)} h au total · à partir de {startTime}
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

      <div className="study-grid" role="grid">
        <div className="study-grid__weekdays" role="row">
          {WEEKDAYS.map((w) => (
            <span key={w} role="columnheader">
              {w}
            </span>
          ))}
        </div>
        {weeks.map((week, wi) => (
          <div className="study-grid__week" role="row" key={wi}>
            {week.map((d, di) =>
              d ? (
                <button
                  key={d.day}
                  role="gridcell"
                  className={[
                    'study-cell',
                    d.minutes > config.sessionMinutes + 1 ? 'study-cell--over' : '',
                    selected === d.day ? 'study-cell--on' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  aria-label={`${formatDay(d.day)}, ${Math.round(d.minutes)} minutes`}
                  aria-pressed={selected === d.day}
                  onClick={() => setSelected(selected === d.day ? null : d.day)}
                >
                  <span className="study-cell__num">
                    {localDate(d.day).getDate()}
                    {monthMarks.has(d.day) && (
                      <span className="study-cell__month"> {MONTH_FMT.format(localDate(d.day))}</span>
                    )}
                  </span>
                  <span className="study-cell__gauge">
                    <span
                      className="study-cell__bar"
                      style={{ width: `${Math.max(6, (d.minutes / peak) * 100)}%` }}
                    />
                  </span>
                  <span className="study-cell__time">{Math.round(d.minutes)}′</span>
                  {d.fresh.length > 0 && (
                    <span className="study-cell__range">
                      {d.fresh[0]!.fromTirade}→{d.fresh[d.fresh.length - 1]!.toTirade}
                    </span>
                  )}
                </button>
              ) : (
                <span key={`${wi}-${di}`} className="study-cell study-cell--empty" role="gridcell" />
              ),
            )}
          </div>
        ))}
      </div>

      <p className="study-hint">
        Chaque barre est la charge du jour, révisions comprises ; en ambre, les séances
        qui dépassent tes {config.sessionMinutes} min. Clique un jour pour voir son
        détail. Prévision et non planning : elle suppose qu'un passage sur trois
        demandera une reprise, et se recale selon ce que tu notes — le fichier exporté,
        lui, fige ces dates.
      </p>

      {selectedDay && (
        <div className="study-detail">
          <div className="study-detail__head">
            <strong>{formatDay(selectedDay.day)}</strong>
            <span className="study-detail__time">
              ~{Math.round(selectedDay.minutes)} min · à partir de {startTime}
            </span>
            <button className="linklike" onClick={() => setSelected(null)}>
              Fermer
            </button>
          </div>
          <WorkBlock label="apprendre" portions={selectedDay.fresh} />
          <WorkBlock label="revoir" portions={selectedDay.due} />
        </div>
      )}
    </section>
  );
}
