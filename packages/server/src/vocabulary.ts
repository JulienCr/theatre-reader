/** Per-play vocabulary hinted to the speech recognizer, memoised by content. */

import { createHash } from 'node:crypto';
import { parseFountain, speechText, type Character } from '@theatre/core';
import { buildVocabulary, splitWords } from '@theatre/voice-match';
import { spellCheckAvailable, unknownWords } from './spell';

const memo = new Map<string, string[]>();

function candidateWords(speechTexts: string[]): string[] {
  const seen = new Set<string>();
  for (const text of speechTexts) {
    for (const { raw } of splitWords(text)) {
      const word = raw.toLowerCase();
      for (const w of [word, ...word.split(/['’]/)]) {
        if (w.length >= 3 && !/\d/.test(w)) seen.add(w);
      }
    }
  }
  return [...seen];
}

/**
 * Words worth hinting for this play, names first.
 * @param fountain play source text
 * @param characters cast, used to bind lines and as the leading names
 */
export async function vocabularyFor(fountain: string, characters: Character[]): Promise<string[]> {
  const names = characters.map((c) => c.canonicalName);
  const key = createHash('sha1').update([fountain, ...names].join('\0')).digest('hex');
  const cached = memo.get(key);
  if (cached) return cached;

  const play = parseFountain(fountain, characters);
  const speechTexts: string[] = [];
  for (const node of play.nodes) {
    if (node.type === 'line') speechTexts.push(speechText(node));
  }

  const unknown = await unknownWords(candidateWords(speechTexts));
  const vocabulary = buildVocabulary({
    characterNames: names,
    speechTexts,
    isKnown: (w) => !unknown.has(w),
  });
  // A degraded checker yields no unknown words: caching that would hide a later fix.
  if (spellCheckAvailable()) memo.set(key, vocabulary);
  return vocabulary;
}
