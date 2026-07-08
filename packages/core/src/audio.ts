/**
 * Configuration audio d'une pièce (lecture ElevenLabs).
 *
 * Vit dans meta.json (pas dans le Template, qui est réutilisable) : les voiceId
 * et le rôle joué sont propres à cette production. Type pur, sans I/O — core est
 * la source de rendu et tourne aussi côté serveur.
 */

/** Réglages de voix ElevenLabs (camelCase, calqué sur le SDK ; tous optionnels). */
export interface VoiceSettings {
  stability?: number;
  similarityBoost?: number;
  style?: number;
  speed?: number;
  useSpeakerBoost?: boolean;
}

export interface AudioConfig {
  /** Modèle ElevenLabs, défaut 'eleven_multilingual_v2'. */
  model?: string;
  /** Le rôle que je joue : silencieux/en pause en mode Répétition. */
  myCharacterId?: string;
  /** characterId -> voiceId ElevenLabs. */
  voices?: Record<string, string>;
  /** Réglages appliqués à toutes les voix (facultatif). */
  settings?: VoiceSettings;
}
