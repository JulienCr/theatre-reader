/**
 * Préparation hors-ligne : rapatrier une pièce du serveur vers le téléphone.
 *
 * Strictement téléchargement — rien ici ne déclenche de synthèse vocale. Le
 * manifeste vient de `/audio/manifest`, qui se contente de calculer les clés et
 * de dire lesquelles sont déjà sur le disque du serveur ; les clips absents sont
 * comptés dans `missing` et signalés à l'utilisateur, jamais générés. Décider de
 * dépenser reste le rôle du bouton « Générer l'audio » de l'atelier web.
 */

import { buildAudioItems, fetchAudioManifest, audioUrl, loadNotes, loadPlay } from '../api';
import * as store from './store';

/**
 * Compté en CLIPS (clés distinctes), pas en répliques : deux répliques au texte
 * identique dites par la même voix partagent la même clé, donc le même fichier.
 * `prepared + missing + skipped` = nombre de clés distinctes, généralement un peu
 * inférieur au nombre de répliques.
 */
export interface PrepareResult {
  /** Clips téléchargés pendant cette exécution. */
  prepared: number;
  /** Clips absents du cache serveur : la pièce sera lisible, mais muette sur ces répliques. */
  missing: number;
  /** Clips déjà présents sur le téléphone, donc non retéléchargés. */
  skipped: number;
}

export interface PrepareProgress {
  done: number;
  total: number;
}

/** Assez de parallélisme pour ne pas traîner sur ~1000 clips, assez peu pour ne pas noyer le serveur. */
const CONCURRENCY = 6;

/**
 * Rapatrie pièce + notes + clips audio déjà en cache côté serveur.
 *
 * Idempotent : une seconde exécution ne retélécharge rien (chaque clip est testé
 * sur le disque local avant l'appel réseau) — on peut donc relancer après une
 * coupure sans repayer le transfert.
 */
export async function prepareOffline(
  slug: string,
  onProgress?: (p: PrepareProgress) => void,
): Promise<PrepareResult> {
  const { fountain, meta } = await loadPlay(slug);
  const notes = await loadNotes(slug);
  await store.savePlay(slug, { fountain, meta });
  await store.saveNotes(slug, notes);

  // `buildAudioItems` est le seul constructeur autorisé : il produit le nodeId du
  // `data-nid` du DOM rendu et le texte normalisé qui entre dans la clé de cache.
  // Toute autre normalisation donnerait des clés introuvables côté serveur.
  const items = buildAudioItems(fountain, meta.characters, meta.audio);
  const manifest = items.length ? await fetchAudioManifest(slug, items, meta.audio) : {};
  const entries = Object.entries(manifest);

  // Impérativement AVANT le pool : les écritures concurrentes ne doivent pas avoir
  // à créer le dossier des clips elles-mêmes (elles s'y disputeraient).
  await store.ensureAudioDir(slug);

  // Dédoublonné par clé : sans ça, deux répliques au texte identique lancent deux
  // téléchargements du même fichier — et, lancées par deux workers en même temps,
  // se voient mutuellement « absentes du disque » et le téléchargent bel et bien
  // deux fois. On travaille donc sur les clips, puis on rebranche les répliques.
  const byKey = new Map<string, boolean>();
  for (const [, entry] of entries) byKey.set(entry.key, entry.cached);
  const clips = [...byKey.entries()];

  const result: PrepareResult = { prepared: 0, missing: 0, skipped: 0 };
  const missingKeys = new Set<string>();
  let cursor = 0;
  let done = 0;

  const worker = async (): Promise<void> => {
    while (cursor < clips.length) {
      const [key, cached] = clips[cursor++]!;
      if (await store.hasClip(slug, key)) {
        result.skipped++;
      } else if (cached) {
        await store.saveClip(slug, key, await downloadBase64(audioUrl(slug, key)));
        result.prepared++;
      } else {
        // Jamais synthétisé ici : un clip absent est signalé, pas fabriqué.
        missingKeys.add(key);
        result.missing++;
      }
      onProgress?.({ done: ++done, total: clips.length });
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // Le manifeste ne référence que les clips réellement présents sur le téléphone :
  // une entrée pointant vers un fichier absent donnerait un `<audio>` en erreur.
  const map: Record<string, string> = {};
  for (const [nodeId, entry] of entries) {
    if (!missingKeys.has(entry.key)) map[nodeId] = entry.key;
  }
  await store.saveManifest(slug, { map });
  return result;
}

/**
 * nodeId -> URL locale du clip, prête à être injectée dans `ReaderData.audio.clips`.
 *
 * Le lecteur consomme `clips[nodeId]` telle quelle comme URL : hors-ligne on y met
 * une URL de fichier local là où le mode en ligne met une URL serveur, et le
 * lecteur, lui, ne change pas.
 */
export async function buildOfflineClips(slug: string): Promise<Record<string, string>> {
  const manifest = await store.loadManifest(slug);
  if (!manifest) return {};
  const clips: Record<string, string> = {};
  await Promise.all(
    Object.entries(manifest.map).map(async ([nodeId, key]) => {
      clips[nodeId] = await store.clipUrl(slug, key);
    }),
  );
  return clips;
}

/** Le plugin Filesystem écrit du binaire à partir de base64 nue (sans préfixe `data:`). */
async function downloadBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  const blob = await res.blob();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('lecture du clip impossible'));
    reader.onload = () => resolve(String(reader.result));
    // Via FileReader plutôt que btoa(String.fromCharCode(...)) : un clip fait
    // plusieurs dizaines de kio, et l'expansion en arguments déborde la pile.
    reader.readAsDataURL(blob);
  });
  return dataUrl.slice(dataUrl.indexOf(',') + 1);
}
