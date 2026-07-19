/**
 * Logger compact pour un serveur local mono-utilisateur : une ligne lisible par
 * message, au lieu du JSON pino par défaut (pid/hostname/reqId/time epoch…).
 *
 * Fastify accepte n'importe quel logger respectant `FastifyBaseLogger` via
 * l'option `loggerInstance` — on évite ainsi une dépendance à pino-pretty.
 * Niveau réglable via `THEATRE_LOG_LEVEL` (trace|debug|info|warn|error|silent) ;
 * silencieux sous vitest pour ne pas polluer la sortie des tests.
 */

import type { FastifyBaseLogger } from 'fastify';

type Level = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

const ORDER: Record<Level | 'silent', number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
  silent: 100,
};

const COLOR = {
  reset: '\u001b[0m',
  dim: '\u001b[2m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  blue: '\u001b[34m',
  magenta: '\u001b[35m',
  cyan: '\u001b[36m',
} as const;

// Sous `pnpm dev`, concurrently pipe la sortie : stdout n'est plus un TTY, d'où
// le FORCE_COLOR posé par le script dev du serveur.
const useColor = !process.env.NO_COLOR && (process.stdout.isTTY || !!process.env.FORCE_COLOR);
const paint = (color: keyof typeof COLOR, text: string) =>
  useColor ? `${COLOR[color]}${text}${COLOR.reset}` : text;

const LEVEL_TAG: Record<Level, string> = {
  trace: paint('dim', 'trace'),
  debug: paint('dim', 'debug'),
  info: paint('cyan', 'info '),
  warn: paint('yellow', 'warn '),
  error: paint('red', 'error'),
  fatal: paint('magenta', 'fatal'),
};

function resolveLevel(): Level | 'silent' {
  if (process.env.VITEST) return 'silent';
  const raw = (process.env.THEATRE_LOG_LEVEL ?? 'info').toLowerCase();
  return raw in ORDER ? (raw as Level | 'silent') : 'info';
}

function hhmmss(): string {
  return new Date().toTimeString().slice(0, 8);
}

/** Détail lisible d'une erreur : `Error`, ou objet sérialisé `{ message, stack }`. */
function errorDetail(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { message, stack } = value as { message?: unknown; stack?: unknown };
  if (typeof message !== 'string') return undefined;
  return typeof stack === 'string' ? `${message}\n${paint('dim', stack)}` : message;
}

/** `JSON.stringify` qui ne fait pas planter le logger sur un objet circulaire. */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * Extrait un message lisible d'un appel pino `(obj, msg)` ou `(msg, …)`.
 * Fastify journalise ses échecs sous la forme `({ req, res, err }, message)` :
 * le message seul perdrait la pile d'exception, on la ré-attache donc.
 */
export function formatLogMessage(args: unknown[]): string {
  const [first, second] = args;
  if (typeof first === 'string') return second === undefined ? first : `${first} ${String(second)}`;

  const payload = first as { err?: unknown; error?: unknown } | undefined;
  const detail = errorDetail(first) ?? errorDetail(payload?.err) ?? errorDetail(payload?.error);
  const prefix = typeof second === 'string' ? second : '';
  if (detail !== undefined) return prefix ? `${prefix} — ${detail}` : detail;

  if (prefix) return prefix;
  return first === undefined ? '' : safeStringify(first);
}

export function createLogger(): FastifyBaseLogger {
  const level = resolveLevel();
  const threshold = ORDER[level];

  const emit = (lvl: Level, args: unknown[]) => {
    if (ORDER[lvl] < threshold) return;
    const line = formatLogMessage(args);
    if (!line) return;
    const out = `${paint('dim', hhmmss())} ${LEVEL_TAG[lvl]} ${line}`;
    if (ORDER[lvl] >= ORDER.error) console.error(out);
    else console.log(out);
  };

  const logger: FastifyBaseLogger = {
    level,
    silent: () => {},
    trace: (...args: unknown[]) => emit('trace', args),
    debug: (...args: unknown[]) => emit('debug', args),
    info: (...args: unknown[]) => emit('info', args),
    warn: (...args: unknown[]) => emit('warn', args),
    error: (...args: unknown[]) => emit('error', args),
    fatal: (...args: unknown[]) => emit('fatal', args),
    child: () => logger,
  } as FastifyBaseLogger;

  return logger;
}

/** `GET /api/voices 200 216ms` — une ligne par requête, statut coloré. */
export function formatRequestLine(
  method: string,
  url: string,
  status: number,
  ms: number,
): string {
  const color = status >= 500 ? 'red' : status >= 400 ? 'yellow' : status >= 300 ? 'dim' : 'green';
  const duration = ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`;
  return `${paint('blue', method)} ${url} ${paint(color, String(status))} ${paint('dim', duration)}`;
}
