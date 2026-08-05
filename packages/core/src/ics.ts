/**
 * Export d'un calendrier d'apprentissage au format iCalendar (RFC 5545), pour
 * l'importer dans Google Calendar, Apple Calendar ou autre. Module pur : il rend
 * une chaîne, l'appelant décide quoi en faire.
 *
 * Un fichier .ics plutôt qu'une API : pas d'OAuth, pas de secret à stocker, pas de
 * serveur de callback — cohérent avec un outil local sans comptes. L'utilisateur
 * importe le fichier, et c'est tout.
 *
 * LIMITE INHÉRENTE, à dire dans l'interface plutôt qu'à laisser découvrir : un
 * calendrier exporté est un INSTANTANÉ d'une prévision. Le plan, lui, se recalcule
 * à chaque ouverture ; dès qu'une séance est manquée ou notée autrement que prévu,
 * les événements déjà dans Google deviennent faux. Il faut ré-exporter.
 *
 * Les heures sont écrites en temps « flottant » (ni `Z`, ni `TZID`) : 19 h 30 y
 * signifie 19 h 30 dans le fuseau de l'agenda qui importe, ce qui est exactement le
 * comportement voulu pour une répétition — et ce qui évite d'embarquer une base de
 * fuseaux horaires pour un fichier qu'on relit chez soi.
 */

import type { PlannedDay } from './study';

export interface IcsOptions {
  /** Nom du rôle, pour les titres d'événements. */
  roleName: string;
  /** Titre de la pièce, pour le nom du calendrier. */
  playTitle: string;
  /** « HH:MM », heure de début des séances. */
  startTime: string;
  /** Durée d'un événement, en minutes. */
  minutes: number;
  /**
   * Horodatage de génération, « YYYYMMDDTHHMMSSZ ». Passé en paramètre : ce module
   * ne lit pas l'horloge, sans quoi deux appels identiques différeraient et le
   * test devrait geler le temps.
   */
  stamp: string;
  /** Préfixe des UID, pour que deux exports d'un même plan se remplacent. */
  uidPrefix: string;
}

/**
 * Horodatage `DTSTAMP`, « YYYYMMDDTHHMMSSZ » en UTC. La `Date` vient de l'appelant :
 * ce module ne lit pas l'horloge.
 */
export function icsStamp(d: Date): string {
  return `${d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`;
}

/**
 * Échappe un texte de propriété : la barre oblique inverse d'abord, sinon on
 * ré-échapperait les échappements qu'on vient d'écrire.
 */
function escapeText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Replie une ligne à 75 octets (RFC 5545 §3.1), en comptant en OCTETS et non en
 * caractères : « ACTE II · SCÈNE 3 » est plus long en UTF-8 qu'à l'écran, et une
 * coupe au milieu d'un caractère multi-octet produit un fichier illisible.
 */
function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;

  const out: string[] = [];
  let current = '';
  let bytes = 0;
  // 74 : la ligne de continuation commence par une espace, qui compte.
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    const limit = out.length === 0 ? 75 : 74;
    if (bytes + size > limit) {
      out.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  if (current) out.push(current);
  return out.join('\r\n ');
}

/** « YYYY-MM-DD » + « HH:MM » → « YYYYMMDDTHHMMSS » (heure flottante). */
function dateTime(day: string, time: string): string {
  return `${day.replace(/-/g, '')}T${time.replace(':', '')}00`;
}

/** Ajoute des minutes à un « HH:MM », en débordant sur le jour suivant si besoin. */
function addMinutes(day: string, time: string, minutes: number): { day: string; time: string } {
  const [h, m] = time.split(':').map(Number) as [number, number];
  const total = h * 60 + m + Math.max(1, Math.round(minutes));
  const dayShift = Math.floor(total / (24 * 60));
  const rest = total % (24 * 60);
  const pad = (n: number): string => String(n).padStart(2, '0');
  let target = day;
  if (dayShift > 0) {
    // Report sur le lendemain : rare (séance très longue tard le soir) mais un
    // DTEND antérieur au DTSTART rendrait l'événement invalide.
    const [y, mo, d] = day.split('-').map(Number) as [number, number, number];
    const shifted = new Date(Date.UTC(y, mo - 1, d + dayShift));
    target = `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
  }
  return { day: target, time: `${pad(Math.floor(rest / 60))}:${pad(rest % 60)}` };
}

/**
 * Résumé d'une journée. Les numéros de tirades situent, l'incipit fait reconnaître
 * — dans un agenda où l'on ne voit qu'une ligne, c'est lui qui dit de quoi il
 * s'agit. Il est coupé court : le titre d'un événement s'affiche tronqué.
 */
function daySummary(d: PlannedDay): string {
  const first = d.fresh[0] ?? d.due[0];
  const parts: string[] = [];
  if (d.fresh.length) {
    parts.push(`${d.fresh[0]!.fromTirade}→${d.fresh[d.fresh.length - 1]!.toTirade}`);
  }
  // En tirades : « portion » est un mot d'implémentation, il n'a rien à faire
  // dans un agenda.
  if (d.due.length) parts.push(`${d.due.reduce((s, p) => s + p.lines, 0)} à revoir`);
  const head = parts.join(' · ') || 'séance';
  const incipit = first?.preview ? ` · « ${first.preview.slice(0, 45)}${first.preview.length > 45 ? '…' : ''} »` : '';
  return head + incipit;
}

function dayDescription(d: PlannedDay): string {
  const lines: string[] = [];
  const label = (p: {
    actLabel: string;
    sceneLabel: string;
    fromTirade: number;
    toTirade: number;
    preview: string;
  }): string => {
    const where = [p.actLabel, p.sceneLabel].filter(Boolean).join(' · ');
    const range =
      p.toTirade !== p.fromTirade ? `${p.fromTirade}→${p.toTirade}` : `${p.fromTirade}`;
    return `  ${where} — tirades ${range}${p.preview ? `\n    « ${p.preview} »` : ''}`;
  };

  if (d.fresh.length) {
    lines.push('Nouveau :');
    for (const p of d.fresh) lines.push(label(p));
  }
  if (d.due.length) {
    lines.push('À réviser :');
    for (const p of d.due) lines.push(label(p));
  }
  lines.push('', `Environ ${Math.round(d.minutes)} min.`);
  lines.push('Prévision : à ré-exporter si le rythme change.');
  return lines.join('\n');
}

/**
 * Calendrier complet. Renvoie `null` s'il n'y a aucune journée à écrire — un .ics
 * sans événement s'importe sans rien faire, ce qui ressemble à un échec silencieux.
 */
export function buildStudyIcs(days: PlannedDay[], opts: IcsOptions): string | null {
  if (!days.length) return null;

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Theatre Reader//Plan d\'apprentissage//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(`${opts.roleName} — ${opts.playTitle}`)}`,
  ];

  for (const d of days) {
    const end = addMinutes(d.day, opts.startTime, opts.minutes);
    lines.push(
      'BEGIN:VEVENT',
      // L'UID dérive du plan et du jour : ré-importer un export mis à jour
      // remplace l'événement au lieu d'en créer un second.
      `UID:${opts.uidPrefix}-${d.day}@theatre-reader`,
      `DTSTAMP:${opts.stamp}`,
      `DTSTART:${dateTime(d.day, opts.startTime)}`,
      `DTEND:${dateTime(end.day, end.time)}`,
      `SUMMARY:${escapeText(`${opts.roleName} — ${daySummary(d)}`)}`,
      `DESCRIPTION:${escapeText(dayDescription(d))}`,
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');
  // CRLF partout : la RFC l'impose, et certains imports le prennent au mot.
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
