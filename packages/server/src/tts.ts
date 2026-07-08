/**
 * Synthèse vocale ElevenLabs (côté serveur uniquement — la clé ne quitte jamais
 * la machine). Calqué sur import/llm.ts : la présence de la clé conditionne la
 * feature, l'échec remonte un message exploitable.
 */

import { ElevenLabsClient, ElevenLabs } from '@elevenlabs/elevenlabs-js';
import type { VoiceSettings } from '@theatre/core';

export const DEFAULT_TTS_MODEL = process.env.THEATRE_TTS_MODEL ?? 'eleven_multilingual_v2';
export const DEFAULT_OUTPUT_FORMAT: ElevenLabs.TextToSpeechConvertRequestOutputFormat =
  'mp3_44100_128';

export function hasElevenLabsKey(): boolean {
  return Boolean(process.env.ELEVENLABS_API_KEY);
}

let client: ElevenLabsClient | null = null;
function getClient(): ElevenLabsClient {
  // Le SDK lit ELEVENLABS_API_KEY dans l'environnement.
  if (!client) client = new ElevenLabsClient();
  return client;
}

export interface VoiceSummary {
  voiceId: string;
  name: string;
  category?: string;
}

// Cache mémoire (la bibliothèque de voix change rarement) — cf. pagedSourceCache.
let voicesCache: VoiceSummary[] | null = null;

export async function listVoices(): Promise<VoiceSummary[]> {
  if (voicesCache) return voicesCache;
  const out: VoiceSummary[] = [];
  let pageToken: string | undefined;
  const cl = getClient();
  do {
    const res = await cl.voices.search({ pageSize: 100, nextPageToken: pageToken });
    for (const v of res.voices ?? []) {
      out.push({ voiceId: v.voiceId, name: v.name ?? v.voiceId, category: v.category });
    }
    pageToken = res.hasMore ? res.nextPageToken : undefined;
  } while (pageToken);
  voicesCache = out;
  return voicesCache;
}

export interface SynthesizeInput {
  text: string;
  voiceId: string;
  model?: string;
  /** Format ElevenLabs, ex. 'mp3_44100_128' (en ligne) ou 'mp3_44100_64' (export). */
  outputFormat?: string;
  settings?: VoiceSettings;
}

/** Génère l'audio d'un texte pour une voix, renvoyé en Buffer MP3. */
export async function synthesize(input: SynthesizeInput): Promise<Buffer> {
  const stream = await getClient().textToSpeech.convert(input.voiceId, {
    text: input.text,
    modelId: input.model ?? DEFAULT_TTS_MODEL,
    outputFormat: (input.outputFormat ??
      DEFAULT_OUTPUT_FORMAT) as ElevenLabs.TextToSpeechConvertRequestOutputFormat,
    voiceSettings: input.settings,
  });
  return streamToBuffer(stream);
}

async function streamToBuffer(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/** Message d'erreur lisible à partir d'une exception du SDK. */
export function ttsErrorMessage(e: unknown): string {
  const status = (e as { statusCode?: number })?.statusCode;
  if (status === 401) return 'Clé ElevenLabs invalide (401).';
  if (status === 422) return 'Paramètres invalides (422) — voix ou modèle inconnu ?';
  if (status === 429) return 'Quota ElevenLabs dépassé (429).';
  return e instanceof Error ? e.message : String(e);
}
