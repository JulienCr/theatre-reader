/**
 * Panneau « Voix » : attribue une voix ElevenLabs à chaque personnage (dont ma
 * propre voix pour le rôle que je joue), avec aperçu audio. Écrit dans meta.audio.
 * Calqué sur CharactersPanel.
 */
import { useState } from 'react';
import type { AudioConfig, Character } from '@theatre/core';
import * as api from '../api';
import type { VoiceSummary } from '../api';

const PREVIEW_TEXT = 'Bonjour, ceci est un essai de voix.';

export function VoicesPanel({
  characters,
  audio,
  voices,
  slug,
  onChange,
}: {
  characters: Character[];
  audio: AudioConfig;
  voices: VoiceSummary[] | null;
  slug: string;
  onChange: (a: AudioConfig) => void;
}) {
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (voices === null) {
    return (
      <section className="panel">
        <h3>Voix</h3>
        <p className="hint">
          Synthèse vocale désactivée. Définis <code>ELEVENLABS_API_KEY</code> (voir le README)
          puis relance le serveur pour attribuer des voix.
        </p>
      </section>
    );
  }

  const voiceOf = (cid: string) => audio.voices?.[cid] ?? '';

  const setVoice = (cid: string, voiceId: string) => {
    const next = { ...(audio.voices ?? {}) };
    if (voiceId) next[cid] = voiceId;
    else delete next[cid];
    onChange({ ...audio, voices: next });
  };

  const setMine = (cid: string) => {
    onChange({ ...audio, myCharacterId: audio.myCharacterId === cid ? undefined : cid });
  };

  const autoAssign = () => {
    if (!voices.length) return;
    const next: Record<string, string> = { ...(audio.voices ?? {}) };
    characters.forEach((c, i) => {
      if (!next[c.id]) next[c.id] = voices[i % voices.length]!.voiceId;
    });
    onChange({ ...audio, voices: next });
  };

  const preview = async (cid: string) => {
    const voiceId = voiceOf(cid);
    if (!voiceId) return;
    setError(null);
    setPreviewing(cid);
    try {
      const blob = await api.tts(slug, { text: PREVIEW_TEXT, voiceId, model: audio.model });
      const url = URL.createObjectURL(blob);
      const a = new Audio(url);
      const revoke = () => URL.revokeObjectURL(url);
      a.onended = revoke;
      a.onerror = revoke;
      // play() rejette si l'autoplay est bloqué : révoquer aussi dans ce cas.
      await a.play().catch((e) => {
        revoke();
        throw e;
      });
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setPreviewing(null);
    }
  };

  const assignedCount = characters.filter((c) => voiceOf(c.id)).length;

  return (
    <section className="panel">
      <h3>
        Voix <span className="muted">({assignedCount}/{characters.length})</span>
      </h3>
      <p className="hint">
        Une voix par personnage. Coche « mon rôle » pour le rôle que tu joues (silencieux en
        mode Répétition).
      </p>
      <div className="voices-actions">
        <button type="button" onClick={autoAssign} disabled={!voices.length}>
          Attribuer automatiquement
        </button>
      </div>
      {error && <p className="hint error">{error}</p>}
      <ul className="char-list">
        {characters.map((c) => {
          const vid = voiceOf(c.id);
          const mine = audio.myCharacterId === c.id;
          return (
            <li key={c.id} className="char-item voice-item">
              <div className="voice-row">
                <span className="char-name">{c.canonicalName}</span>
                <label className="voice-mine" title="Le rôle que je joue">
                  <input type="checkbox" checked={mine} onChange={() => setMine(c.id)} />
                  moi
                </label>
              </div>
              <div className="voice-row">
                <select value={vid} onChange={(e) => setVoice(c.id, e.target.value)}>
                  <option value="">— aucune —</option>
                  {voices.map((v) => (
                    <option key={v.voiceId} value={v.voiceId}>
                      {v.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="voice-preview"
                  title="Écouter un essai"
                  disabled={!vid || previewing === c.id}
                  onClick={() => preview(c.id)}
                >
                  {previewing === c.id ? '…' : '🔊'}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
