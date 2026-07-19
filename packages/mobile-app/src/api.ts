/**
 * Client de l'API du serveur local (@theatre/server), vue depuis le téléphone.
 *
 * Volontairement minimal : lecture des pièces, des notes, et fabrication des URL
 * de clips audio. Rien n'est mis en cache ici — le stockage hors-ligne viendra
 * dans une étape ultérieure, et il consommera les mêmes fonctions.
 */

import {
  buildNodeIds,
  parseFountain,
  speechTextForTts,
  type AudioConfig,
  type Character,
  type Note,
  type Template,
} from '@theatre/core';
import { apiUrl } from './settings';

/** Miroir de `PlayMeta` (server/src/storage.ts), qui n'est pas exporté vers le client. */
export interface PlayMeta {
  name: string;
  characters: Character[];
  template: Template;
  audio?: AudioConfig;
}

/** Un item de `/tts/batch` : le texte exact qui entre dans la clé de cache. */
export interface AudioItem {
  nodeId: string;
  voiceId: string;
  text: string;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(apiUrl(path));
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

export function listPlays(): Promise<{ plays: { slug: string; name: string }[] }> {
  return getJson('/api/plays');
}

export function loadPlay(slug: string): Promise<{ fountain: string; meta: PlayMeta }> {
  return getJson(`/api/plays/${encodeURIComponent(slug)}`);
}

export async function loadNotes(slug: string): Promise<Note[]> {
  const { notes } = await getJson<{ notes: Note[] }>(
    `/api/plays/${encodeURIComponent(slug)}/notes`,
  );
  return notes;
}

/** URL du clip en cache disque, servi par clé (hash de contenu, donc immuable). */
export function audioUrl(slug: string, key: string): string {
  return apiUrl(`/api/plays/${encodeURIComponent(slug)}/audio/${encodeURIComponent(key)}`);
}

/**
 * Tirades à confier à `/tts/batch`, une par réplique d'un personnage qui a une voix.
 *
 * `buildNodeIds` et `speechTextForTts` ne sont pas interchangeables avec autre
 * chose : le nodeId doit être celui du `data-nid` du DOM rendu (c'est par lui que
 * le lecteur retrouve le clip d'une réplique), et `speechTextForTts` est le
 * normalisateur canonique du texte qui entre dans la clé de cache. Toute autre
 * normalisation produit une clé différente → cache manqué silencieux → l'API
 * ElevenLabs regénère, en facturant, ce qui existe déjà sur le disque.
 */
export function buildAudioItems(
  fountain: string,
  characters: Character[],
  audio?: AudioConfig,
): AudioItem[] {
  const voices = audio?.voices;
  if (!voices) return [];
  const play = parseFountain(fountain, characters);
  const ids = buildNodeIds(play);
  const items: AudioItem[] = [];
  play.nodes.forEach((node, i) => {
    if (node.type !== 'line') return;
    const voiceId = voices[node.characterId];
    if (!voiceId) return;
    const text = speechTextForTts(node);
    if (text) items.push({ nodeId: ids[i]!, voiceId, text });
  });
  return items;
}

/**
 * nodeId -> URL du clip servi par le serveur (lecture en ligne).
 *
 * Ne lève jamais : un serveur sans clé ElevenLabs répond 503 à `/tts/batch`, et
 * l'absence d'audio ne doit pas empêcher de lire la pièce. Le lecteur se câble
 * sur l'audio seulement si la table est non vide.
 */
export async function buildOnlineClips(
  slug: string,
  fountain: string,
  meta: PlayMeta,
): Promise<Record<string, string>> {
  const items = buildAudioItems(fountain, meta.characters, meta.audio);
  if (!items.length) return {};
  try {
    const res = await fetch(apiUrl(`/api/plays/${encodeURIComponent(slug)}/tts/batch`), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items, model: meta.audio?.model, settings: meta.audio?.settings }),
    });
    if (!res.ok) return {};
    const { manifest } = (await res.json()) as {
      manifest?: Record<string, { key: string }>;
    };
    const clips: Record<string, string> = {};
    for (const [nodeId, entry] of Object.entries(manifest ?? {})) {
      clips[nodeId] = audioUrl(slug, entry.key);
    }
    return clips;
  } catch {
    return {};
  }
}
