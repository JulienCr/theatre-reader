/**
 * Stockage local sur le système de fichiers (outil mono-utilisateur, pas de DB).
 * Une pièce = un dossier `data/<slug>/` contenant :
 *   - play.fountain : le texte source éditable (source de vérité de la structure)
 *   - meta.json     : { name, characters, template } — alias/descriptions des
 *                     personnages et template courant, que Fountain ne porte pas.
 */

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { AudioConfig, Character, Note, Template, slugify } from '@theatre/core';

export interface PlayMeta {
  name: string;
  characters: Character[];
  template: Template;
  /** Config audio (voix ElevenLabs par personnage) — optionnelle, rétro-compatible. */
  audio?: AudioConfig;
}

const DATA_DIR =
  process.env.THEATRE_DATA_DIR ?? fileURLToPath(new URL('../../../data/', import.meta.url));

export function dataDir(): string {
  return DATA_DIR;
}

export async function listPlays(): Promise<{ slug: string; name: string }[]> {
  try {
    const entries = await readdir(DATA_DIR, { withFileTypes: true });
    const plays: { slug: string; name: string }[] = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      try {
        const meta = JSON.parse(await readFile(join(DATA_DIR, e.name, 'meta.json'), 'utf8'));
        plays.push({ slug: e.name, name: meta.name ?? e.name });
      } catch {
        /* dossier sans meta : ignoré */
      }
    }
    return plays.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

export async function loadPlay(
  slug: string,
): Promise<{ fountain: string; meta: PlayMeta } | null> {
  try {
    const dir = join(DATA_DIR, slug);
    const fountain = await readFile(join(dir, 'play.fountain'), 'utf8');
    const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8')) as PlayMeta;
    return { fountain, meta };
  } catch {
    return null;
  }
}

export async function savePlay(slug: string, fountain: string, meta: PlayMeta): Promise<void> {
  const dir = join(DATA_DIR, slug);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'play.fountain'), fountain, 'utf8');
  await writeFile(join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
}

/** Charge les notes d'une pièce (liste vide si le fichier n'existe pas). */
export async function loadNotes(slug: string): Promise<Note[]> {
  try {
    return JSON.parse(await readFile(join(DATA_DIR, slug, 'notes.json'), 'utf8')) as Note[];
  } catch (e) {
    // Fichier absent → pas encore de notes. Toute autre erreur (JSON corrompu,
    // I/O) doit remonter : sinon un saveNotes() ultérieur écraserait les notes.
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
}

/** Écrit les notes d'une pièce dans data/<slug>/notes.json. */
export async function saveNotes(slug: string, notes: Note[]): Promise<void> {
  const dir = join(DATA_DIR, slug);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'notes.json'), JSON.stringify(notes, null, 2), 'utf8');
}

/**
 * Clé de cache audio = hash du contenu qui détermine le rendu (modèle, voix,
 * réglages, texte). Éditer une réplique change le texte → nouvelle clé →
 * régénération naturelle (l'ancien fichier devient orphelin).
 */
export function audioCacheKey(
  model: string,
  voiceId: string,
  outputFormat: string,
  settings: unknown,
  text: string,
): string {
  return createHash('sha1')
    .update(`${model} ${voiceId} ${outputFormat} ${JSON.stringify(settings ?? {})} ${text}`)
    .digest('hex');
}

/** Lit un MP3 en cache (data/<slug>/audio/<key>.mp3), ou null si absent. */
export async function readAudioCache(slug: string, key: string): Promise<Buffer | null> {
  try {
    return await readFile(join(DATA_DIR, slug, 'audio', `${key}.mp3`));
  } catch {
    return null;
  }
}

/** Écrit un MP3 en cache pour une pièce. */
export async function writeAudioCache(slug: string, key: string, buf: Buffer): Promise<void> {
  const dir = join(DATA_DIR, slug, 'audio');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${key}.mp3`), buf);
}

/** Slug unique dérivé d'un titre, en évitant les collisions de dossiers existants. */
export async function uniqueSlug(title: string): Promise<string> {
  const base = slugify(title || 'piece');
  const existing = new Set((await listPlays()).map((p) => p.slug));
  if (!existing.has(base)) return base;
  let n = 2;
  while (existing.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
