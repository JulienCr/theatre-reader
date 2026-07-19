/**
 * Données injectées dans le .html exporté (`window.__THEATRE_READER_DATA__`).
 *
 * Isolées d'`index.ts` pour que le chrome React puisse les typer sans importer
 * le module de démarrage (qui l'importe déjà) : ça éviterait un cycle.
 */
import type { Note } from '@theatre/core';

export interface ReaderData {
  characters: { id: string; name: string }[];
  toc: { id: string; label: string; scene: boolean }[];
  highlightsDefault: { characterId: string; color: string }[];
  notes?: Note[];
  storageKey: string;
  /** Audio embarqué (export opt-in) : nodeId -> data URI, + mon rôle. */
  audio?: { clips: Record<string, string>; myCharacterId?: string };
}
