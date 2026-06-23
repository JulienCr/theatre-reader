/**
 * Pipeline d'import complète : PDF → AST + Fountain.
 *   extract (pdfjs) → heuristiques (structure) → résolution des personnages
 *   (LLM si clé dispo, sinon fuzzy) → AST consolidé → Fountain.
 */

import { Play, serializeFountain } from '@theatre/core';
import { extractPdf } from './extract';
import { runHeuristics } from './heuristics';
import { applyMapping, countCues, fuzzyMerge, CharacterMapping } from './characters';
import { hasApiKey, llmMergeCharacters } from './llm';

export interface ImportOptions {
  /** Forcer ou désactiver l'étape LLM. Par défaut : activée si clé API présente. */
  useLlm?: boolean;
}

export interface ImportResult {
  play: Play;
  fountain: string;
  /** Nombre de personnages consolidés. */
  characterCount: number;
  /** L'étape LLM a-t-elle été utilisée avec succès ? */
  usedLlm: boolean;
}

export async function importPdf(
  data: Uint8Array,
  opts: ImportOptions = {},
): Promise<ImportResult> {
  const doc = await extractPdf(data);
  const raw = runHeuristics(doc);
  const cues = countCues(raw.play);

  const wantLlm = opts.useLlm ?? hasApiKey();
  let mapping: CharacterMapping;
  let usedLlm = false;
  if (wantLlm && hasApiKey()) {
    try {
      mapping = await llmMergeCharacters(cues, raw.declared);
      usedLlm = true;
    } catch {
      mapping = fuzzyMerge(cues, raw.declared);
    }
  } else {
    mapping = fuzzyMerge(cues, raw.declared);
  }

  const play = applyMapping(raw, mapping);
  return {
    play,
    fountain: serializeFountain(play),
    characterCount: play.characters.length,
    usedLlm,
  };
}
