/**
 * Vocabulary hints for speech recognition (`contextualStrings`).
 */
import { fold, splitWords } from './normalize';

export interface VocabularyInput {
  /** Character names as stored, often uppercase ("GIUSEPPE", "VOIX JOURNAL"). */
  characterNames: string[];
  /** Spoken text only: the caller has already excluded stage directions. */
  speechTexts: string[];
  /** Spell check; receives the word lowercased, accents kept, never a number. */
  isKnown: (word: string) => boolean;
  /** Maximum number of entries returned (default 100). */
  max?: number;
}

const MIN_LENGTH = 3;
const DEFAULT_MAX = 100;

function titleCase(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) =>
      word
        .split('-')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
        .join('-'),
    )
    .join(' ');
}

/** Drops an elided prefix ("l'", "qu'") so the spell check sees the word itself. */
function stripElision(raw: string): string {
  return raw.slice(Math.max(raw.lastIndexOf("'"), raw.lastIndexOf('’')) + 1);
}

interface Stat {
  raw: string;
  count: number;
  proper: boolean;
}

function byCountThenKey(a: [string, Stat], b: [string, Stat]): number {
  return b[1].count - a[1].count || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
}

/**
 * Builds the ordered, deduplicated hint list: character names, then proper
 * nouns of the text, then other words, both only when the spell check does not
 * know their lowercase form.
 * @returns at most `max` entries; names are never cut before the other categories.
 */
export function buildVocabulary(input: VocabularyInput): string[] {
  const { characterNames, speechTexts, isKnown, max = DEFAULT_MAX } = input;
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (word: string): void => {
    const key = fold(word);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(word);
  };

  for (const name of characterNames) {
    const formatted = titleCase(name);
    if (formatted) push(formatted);
  }

  const stats = new Map<string, Stat>();
  for (const text of speechTexts) {
    for (const token of splitWords(text)) {
      const word = stripElision(token.raw);
      if (word.length < MIN_LENGTH || /^\d+$/.test(word)) continue;
      const key = fold(word);
      const stat = stats.get(key);
      if (stat) {
        stat.count++;
        if (token.proper && !stat.proper) stat.raw = word;
        stat.proper ||= token.proper;
      } else {
        stats.set(key, { raw: word, count: 1, proper: token.proper });
      }
    }
  }
  const ranked = [...stats.entries()].sort(byCountThenKey);

  // A capitalised ordinary word ("Merci", "Porte", or "NON" shouted) is no proper noun:
  // only words whose lowercase form is unknown are worth a slot, or they flood the cap.
  const unknown = ranked.filter(([, stat]) => !isKnown(stat.raw.toLowerCase()));
  for (const [, stat] of unknown) if (stat.proper) push(stat.raw);
  for (const [, stat] of unknown) if (!stat.proper) push(stat.raw.toLowerCase());

  return out.slice(0, Math.max(0, max));
}
