/**
 * Stockage local sur le système de fichiers (outil mono-utilisateur, pas de DB).
 * Une pièce = un dossier `data/<slug>/` contenant :
 *   - play.fountain : le texte source éditable (source de vérité de la structure)
 *   - meta.json     : { name, characters, template } — alias/descriptions des
 *                     personnages et template courant, que Fountain ne porte pas.
 */

import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  AudioConfig,
  Character,
  Note,
  StudyState,
  Template,
  isValidSlug,
  parseStudyState,
  slugify,
} from '@theatre/core';

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

/**
 * Le dossier d'une pièce — **le seul** endroit où un slug devient un chemin.
 *
 * Fastify décode les paramètres d'URL avant le handler : sans cette garde, un
 * slug comme `..%2F..%2Fetc` sortait de `data/` à travers le `join`, en lecture
 * comme en écriture (`savePlay`, `saveNotes`, `writeAudioCache`). Le serveur
 * refuse déjà ces slugs en amont (hook `onRequest`) ; ceci est la seconde ligne,
 * celle qui couvre aussi les appels internes et les routes à venir.
 */
function playDir(slug: string): string {
  if (!isValidSlug(slug)) throw new Error(`slug invalide : ${slug}`);
  return join(DATA_DIR, slug);
}

export async function listPlays(): Promise<{ slug: string; name: string }[]> {
  try {
    const entries = await readdir(DATA_DIR, { withFileTypes: true });
    const plays: { slug: string; name: string }[] = [];
    for (const e of entries) {
      // Un dossier au nom hors motif ne sera servi par aucune route (cf. playDir) :
      // le proposer dans la liste ne mènerait qu'à une pièce impossible à ouvrir.
      if (!e.isDirectory() || !isValidSlug(e.name)) continue;
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
    const dir = playDir(slug);
    const fountain = await readFile(join(dir, 'play.fountain'), 'utf8');
    const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8')) as PlayMeta;
    return { fountain, meta };
  } catch {
    return null;
  }
}

export async function savePlay(slug: string, fountain: string, meta: PlayMeta): Promise<void> {
  const dir = playDir(slug);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'play.fountain'), fountain, 'utf8');
  await writeFile(join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
}

/** Charge les notes d'une pièce (liste vide si le fichier n'existe pas). */
export async function loadNotes(slug: string): Promise<Note[]> {
  try {
    return JSON.parse(await readFile(join(playDir(slug), 'notes.json'), 'utf8')) as Note[];
  } catch (e) {
    // Fichier absent → pas encore de notes. Toute autre erreur (JSON corrompu,
    // I/O, slug invalide) doit remonter : sinon un saveNotes() ultérieur
    // écraserait les notes.
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
}

/** Écrit les notes d'une pièce dans data/<slug>/notes.json. */
export async function saveNotes(slug: string, notes: Note[]): Promise<void> {
  const dir = playDir(slug);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'notes.json'), JSON.stringify(notes, null, 2), 'utf8');
}

/** Charge le plan d'apprentissage d'une pièce (null s'il n'a jamais été configuré). */
export async function loadStudy(slug: string): Promise<StudyState | null> {
  let raw: string;
  try {
    raw = await readFile(join(playDir(slug), 'study.json'), 'utf8');
  } catch (e) {
    // Fichier absent → pas encore de plan. Toute autre erreur (JSON corrompu,
    // I/O) doit remonter, pour la même raison que loadNotes : sinon un
    // saveStudy() ultérieur écraserait une progression bien réelle — ici des
    // semaines de travail, pas une préférence d'affichage.
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
  // Un JSON syntaxiquement valide mais structurellement faux (version inconnue,
  // champs manquants) doit être refusé ICI, sinon le GET sert un état incohérent
  // que le client ne sait pas interpréter. Même verdict que la corruption : on
  // lève plutôt que de renvoyer null, qui inviterait à écraser le fichier.
  const study = parseStudyState(JSON.parse(raw));
  if (!study) throw new Error(`study.json inexploitable pour « ${slug} »`);
  return study;
}

/** Écrit le plan d'apprentissage dans data/<slug>/study.json. */
export async function saveStudy(slug: string, study: StudyState): Promise<void> {
  const dir = playDir(slug);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'study.json'), JSON.stringify(study, null, 2), 'utf8');
}

/**
 * Supprime le plan d'apprentissage. Un fichier déjà absent n'est pas une erreur :
 * l'appelant voulait qu'il n'y en ait plus, c'est le cas.
 */
export async function deleteStudy(slug: string): Promise<void> {
  try {
    await rm(join(playDir(slug), 'study.json'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
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
    return await readFile(join(playDir(slug), 'audio', `${key}.mp3`));
  } catch (e) {
    // Clip absent → cas nominal, tout le cache est bâti là-dessus. Le reste doit
    // remonter, comme dans loadNotes : un cache devenu illisible (droits, disque)
    // rendu comme « absent » relance une synthèse ElevenLabs — c'est-à-dire une
    // dépense réelle — à chaque lecture, et sans jamais rien dire. Un slug
    // invalide s'y ajoute depuis playDir : le taire renverrait « clip absent »
    // pour une requête qui n'a simplement pas le droit d'exister.
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

/** Écrit un MP3 en cache pour une pièce. */
export async function writeAudioCache(slug: string, key: string, buf: Buffer): Promise<void> {
  const dir = join(playDir(slug), 'audio');
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
