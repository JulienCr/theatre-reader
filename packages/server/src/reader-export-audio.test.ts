import { mkdtempSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// `DATA_DIR` (storage) est mémoïsé à l'import et `hasElevenLabsKey()` lit l'env à
// l'usage : on fixe le cache dans un dossier temporaire et on retire toute clé
// AVANT les imports dynamiques, pour prouver la réutilisation du cache hors-ligne.
const DATA_DIR = mkdtempSync(join(tmpdir(), 'theatre-reader-audio-'));
process.env.THEATRE_DATA_DIR = DATA_DIR;
delete process.env.ELEVENLABS_API_KEY;

const { exportReaderHtml } = await import('./reader-export');
const { audioCacheKey } = await import('./storage');
const { DEFAULT_TTS_MODEL, DEFAULT_OUTPUT_FORMAT } = await import('./tts');
const { parseFountain, speechTextForTts, actorReadingTemplate } = await import('@theatre/core');

const SRC = `# ACTE I.\n\n## SCENE I.\n\nMICHEL\nBonjour à tous.\n\nBENJI\nSalut Michel.\n`;
const VOICE = 'voice-michel';

// Première réplique (MICHEL / « Bonjour à tous. ») : sert d'ancre pour la clé de cache.
const firstLine = (() => {
  const l = parseFountain(SRC, []).nodes.find((n) => n.type === 'line');
  if (!l || l.type !== 'line') throw new Error('fixture invalide : aucune réplique');
  return l;
})();

describe('exportReaderHtml — audio (réutilisation du cache)', () => {
  it('réutilise un clip déjà en cache sans clé ElevenLabs (namespace 128 + texte normalisé)', async () => {
    const slug = 'piece-cache-hit';
    const text = speechTextForTts(firstLine);
    // Clé calculée EXACTEMENT comme /tts/batch (bouton « Générer l'audio ») : même modèle,
    // même format 128, mêmes settings (null), même texte normalisé. Verrou de parité :
    // si l'export changeait de format ou de normalisation de texte, ce hit échouerait.
    const key = audioCacheKey(DEFAULT_TTS_MODEL, VOICE, DEFAULT_OUTPUT_FORMAT, null, text);
    const bytes = Buffer.from('FAKE-MP3-michel-bonjour');
    await mkdir(join(DATA_DIR, slug, 'audio'), { recursive: true });
    await writeFile(join(DATA_DIR, slug, 'audio', `${key}.mp3`), bytes);

    const { html } = await exportReaderHtml(SRC, [], actorReadingTemplate, [], {
      includeAudio: true,
      audio: { voices: { [firstLine.characterId]: VOICE } },
      slug,
    });

    // Le clip semé est embarqué tel quel (aucune clé posée → pas de re-synthèse possible).
    expect(html).toContain('data:audio/mpeg;base64,');
    expect(html).toContain(bytes.toString('base64'));
  });

  it("export gracieux : cache vide + aucune clé → n'embarque aucun audio et ne throw pas", async () => {
    const { html } = await exportReaderHtml(SRC, [], actorReadingTemplate, [], {
      includeAudio: true,
      // Personnage réel avec voix mais aucun clip en cache : le worker rate le cache,
      // pas de clé → on saute le clip → aucun `audio` injecté (retour undefined).
      audio: { voices: { [firstLine.characterId]: 'voice-jamais-generee' } },
      slug: 'piece-sans-cache',
    });
    expect(html).not.toContain('data:audio/mpeg');
    expect(html).not.toContain('"audio":');
  });
});
