/**
 * Stockage local sur le système de fichiers (outil mono-utilisateur, pas de DB).
 * Une pièce = un dossier `data/<slug>/` contenant :
 *   - play.fountain : le texte source éditable (source de vérité de la structure)
 *   - meta.json     : { name, characters, template } — alias/descriptions des
 *                     personnages et template courant, que Fountain ne porte pas.
 */

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { Character, Template, slugify } from '@theatre/core';

export interface PlayMeta {
  name: string;
  characters: Character[];
  template: Template;
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

/** Slug unique dérivé d'un titre, en évitant les collisions de dossiers existants. */
export async function uniqueSlug(title: string): Promise<string> {
  const base = slugify(title || 'piece');
  const existing = new Set((await listPlays()).map((p) => p.slug));
  if (!existing.has(base)) return base;
  let n = 2;
  while (existing.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
