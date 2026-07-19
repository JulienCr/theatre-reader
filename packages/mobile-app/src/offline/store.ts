/**
 * Stockage hors-ligne de l'app : la pièce, ses notes et ses clips audio sur le
 * système de fichiers du téléphone.
 *
 * Arborescence, sous `Directory.Data` (privé à l'app, survit aux redémarrages,
 * effacé à la désinstallation) :
 *
 *   theatre/<slug>/play.json           { fountain, meta }
 *   theatre/<slug>/notes.json          Note[]
 *   theatre/<slug>/audio-manifest.json { map: nodeId -> clé }
 *   theatre/<slug>/audio/<key>.mp3     un clip du cache serveur
 *
 * Les clips gardent la clé du serveur comme nom de fichier — un hash du contenu
 * (modèle + voix + format + réglages + texte). Un nom immuable : si le texte
 * d'une réplique change, la clé change, et le fichier périmé devient simplement
 * orphelin au lieu d'être servi à tort.
 */

import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import type { Note } from '@theatre/core';
import type { PlayMeta } from '../api';

/** Ce que l'app a besoin de connaître d'une pièce pour la rendre sans réseau. */
export interface StoredPlay {
  fountain: string;
  meta: PlayMeta;
}

/**
 * Manifeste audio local : nodeId -> clé du clip.
 *
 * Enveloppé dans un objet plutôt qu'une table nue pour pouvoir lui ajouter des
 * champs (date de préparation, modèle utilisé…) sans casser les fichiers déjà
 * écrits sur les téléphones.
 */
export interface OfflineManifest {
  map: Record<string, string>;
}

const ROOT = 'theatre';

const playDir = (slug: string): string => `${ROOT}/${slug}`;
const clipPath = (slug: string, key: string): string => `${playDir(slug)}/audio/${key}.mp3`;

async function writeJson(path: string, value: unknown): Promise<void> {
  await Filesystem.writeFile({
    path,
    data: JSON.stringify(value),
    directory: Directory.Data,
    encoding: Encoding.UTF8,
    // Le dossier de la pièce n'existe pas à la première préparation.
    recursive: true,
  });
}

/** null si le fichier est absent : « pas encore préparé » n'est pas une erreur. */
async function readJson<T>(path: string): Promise<T | null> {
  try {
    const { data } = await Filesystem.readFile({
      path,
      directory: Directory.Data,
      encoding: Encoding.UTF8,
    });
    // `readFile` peut rendre un Blob sur le web ; sur natif c'est toujours une chaîne.
    return JSON.parse(typeof data === 'string' ? data : await data.text()) as T;
  } catch {
    return null;
  }
}

export function savePlay(slug: string, play: StoredPlay): Promise<void> {
  return writeJson(`${playDir(slug)}/play.json`, play);
}

export function loadPlay(slug: string): Promise<StoredPlay | null> {
  return readJson<StoredPlay>(`${playDir(slug)}/play.json`);
}

export function saveNotes(slug: string, notes: Note[]): Promise<void> {
  return writeJson(`${playDir(slug)}/notes.json`, notes);
}

export async function loadNotes(slug: string): Promise<Note[]> {
  return (await readJson<Note[]>(`${playDir(slug)}/notes.json`)) ?? [];
}

export function saveManifest(slug: string, manifest: OfflineManifest): Promise<void> {
  return writeJson(`${playDir(slug)}/audio-manifest.json`, manifest);
}

export function loadManifest(slug: string): Promise<OfflineManifest | null> {
  return readJson<OfflineManifest>(`${playDir(slug)}/audio-manifest.json`);
}

/**
 * Crée `theatre/<slug>/audio` à l'avance, avant d'y écrire des clips en parallèle.
 *
 * Sans ça, plusieurs `saveClip` concurrents demandent chacun la création du dossier
 * manquant et se marchent dessus (« Current directory does already exist »). Créer
 * une fois, en amont, supprime la course : ensuite le dossier existe et `recursive`
 * n'a plus rien à faire.
 */
export async function ensureAudioDir(slug: string): Promise<void> {
  try {
    await Filesystem.mkdir({
      path: `${playDir(slug)}/audio`,
      directory: Directory.Data,
      recursive: true,
    });
  } catch {
    // Déjà créé par une préparation précédente : c'est le cas nominal au 2e passage.
  }
}

/** `base64` sans préfixe `data:` : c'est ce que le plugin attend pour écrire du binaire. */
export async function saveClip(slug: string, key: string, base64: string): Promise<void> {
  await Filesystem.writeFile({
    path: clipPath(slug, key),
    data: base64,
    directory: Directory.Data,
    // Pas d'`encoding` : le plugin décode alors la base64 et écrit les octets bruts.
    recursive: true,
  });
}

/** Un clip déjà sur le disque n'est pas re-téléchargé (préparation idempotente). */
export async function hasClip(slug: string, key: string): Promise<boolean> {
  try {
    await Filesystem.stat({ path: clipPath(slug, key), directory: Directory.Data });
    return true;
  } catch {
    return false;
  }
}

/**
 * URL du clip local, consommable telle quelle par `<audio src>`.
 *
 * `convertFileSrc` traduit le `file://` natif vers le schéma que la WebView sait
 * charger — la charger directement en `file://` échouerait silencieusement.
 */
export async function clipUrl(slug: string, key: string): Promise<string> {
  const { uri } = await Filesystem.getUri({
    path: clipPath(slug, key),
    directory: Directory.Data,
  });
  return Capacitor.convertFileSrc(uri);
}

/** Pièces préparées sur ce téléphone, avec leur nom lisible pour l'écran de choix. */
export async function listLocalPlays(): Promise<{ slug: string; name: string }[]> {
  let entries;
  try {
    entries = (await Filesystem.readdir({ path: ROOT, directory: Directory.Data })).files;
  } catch {
    // Rien n'a jamais été préparé : le dossier racine n'existe pas encore.
    return [];
  }
  const plays: { slug: string; name: string }[] = [];
  for (const entry of entries) {
    if (entry.type !== 'directory') continue;
    const stored = await loadPlay(entry.name);
    plays.push({ slug: entry.name, name: stored?.meta.name ?? entry.name });
  }
  return plays;
}
