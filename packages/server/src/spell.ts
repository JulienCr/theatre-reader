/**
 * macOS French spell checker, used to find words a speech recognizer will not
 * know (rare or invented words in a play). Falls back to "everything is known".
 */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const SOURCE = fileURLToPath(new URL('./spell/spellcheck.swift', import.meta.url));
const CACHE_DIR = fileURLToPath(new URL('../.cache/spell/', import.meta.url));
const TIMEOUT_MS = 30_000;

let degraded = false;
let warned = false;
let binary: Promise<string> | undefined;

/** False once a call fell back to the empty set; callers must not cache results then. */
export function spellCheckAvailable(): boolean {
  return !degraded;
}

function run(cmd: string, args: string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      cmd,
      args,
      { timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    );
    if (input !== undefined) child.stdin?.end(input);
  });
}

async function compiledBinary(): Promise<string> {
  const hash = createHash('sha1').update(await readFile(SOURCE)).digest('hex').slice(0, 12);
  const out = `${CACHE_DIR}spellcheck-${hash}`;
  if (!existsSync(out)) {
    await mkdir(CACHE_DIR, { recursive: true });
    await run('swiftc', ['-O', SOURCE, '-o', out]);
  }
  return out;
}

/**
 * Words (as given) that the French spell checker rejects.
 * Never throws: on any failure it warns once and resolves to an empty set,
 * which reads as "everything is known" and so simply adds no vocabulary.
 */
export async function unknownWords(words: string[]): Promise<Set<string>> {
  const clean = words.filter((w) => w && !/[\r\n]/.test(w));
  if (clean.length === 0) return new Set();
  try {
    if (process.platform !== 'darwin' || process.env.THEATRE_DISABLE_SPELLCHECK) {
      throw new Error('spell checker unavailable on this platform');
    }
    // A failed compile is not memoised, so a later call can retry.
    binary ??= compiledBinary().catch((e) => {
      binary = undefined;
      throw e;
    });
    const stdout = await run(await binary, [], clean.join('\n') + '\n');
    degraded = false;
    return new Set(stdout.split('\n').filter(Boolean));
  } catch (e) {
    degraded = true;
    if (!warned) {
      warned = true;
      console.warn(`spell checker disabled: ${e instanceof Error ? e.message : String(e)}`);
    }
    return new Set();
  }
}
