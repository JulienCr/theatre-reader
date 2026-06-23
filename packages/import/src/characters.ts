/**
 * Résolution d'identité des personnages : regroupe les orthographes brutes des
 * cues (coquilles incluses) en personnages canoniques, et applique ce mapping à
 * la structure parsée.
 *
 * `fuzzyMerge` est le repli déterministe (sans IA) ; `llmMergeCharacters`
 * (llm.ts) fournit une version plus fiable quand une clé API est disponible.
 * Les deux renvoient le même type `CharacterMapping`.
 */

import { Character, Node, Play, slugify } from '@theatre/core';
import { DeclaredCharacter, RawParse } from './heuristics';

export interface ResolvedCharacter {
  canonicalName: string;
  /** Toutes les orthographes (cues + nom déclaré) désignant ce personnage. */
  aliases: string[];
  description?: string;
}

export type CharacterMapping = ResolvedCharacter[];

export interface CueCount {
  name: string;
  count: number;
}

/** Compte les occurrences de chaque orthographe de cue dans la structure brute. */
export function countCues(play: Play): CueCount[] {
  const byId = new Map(play.characters.map((c) => [c.id, c.canonicalName]));
  const counts = new Map<string, number>();
  for (const n of play.nodes) {
    if (n.type !== 'line') continue;
    const name = byId.get(n.characterId);
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + cost);
    }
  }
  return dp[m]![n]!;
}

function firstToken(s: string): string {
  return s.toUpperCase().split(/\s+/)[0] ?? '';
}

/** Repli déterministe : regroupe les cues par proximité avec les noms déclarés. */
export function fuzzyMerge(cues: CueCount[], declared: DeclaredCharacter[]): CharacterMapping {
  const resolved: ResolvedCharacter[] = declared.map((d) => ({
    canonicalName: d.name,
    aliases: [d.name],
    description: d.description || undefined,
  }));
  const countByName = new Map(cues.map((c) => [c.name.toUpperCase(), c.count]));

  const findFor = (cue: string): ResolvedCharacter | null => {
    const cu = cue.toUpperCase();
    for (const r of resolved) {
      if (r.aliases.some((a) => a.toUpperCase() === cu)) return r;
    }
    let best: ResolvedCharacter | null = null;
    let bestScore = Infinity;
    for (const r of resolved) {
      for (const a of r.aliases) {
        const A = a.toUpperCase();
        let d = Math.min(levenshtein(cu, A), levenshtein(firstToken(cue), firstToken(a)));
        if (firstToken(a) === firstToken(cue) || A.startsWith(cu) || cu.startsWith(firstToken(a))) {
          d = Math.min(d, 1);
        }
        if (d < bestScore) {
          bestScore = d;
          best = r;
        }
      }
    }
    return best && bestScore <= 2 ? best : null;
  };

  // Du plus fréquent au moins fréquent, pour que le nom canonique le plus utilisé gagne.
  for (const { name } of cues) {
    let target = findFor(name);
    if (!target) {
      target = { canonicalName: name, aliases: [], description: undefined };
      resolved.push(target);
    }
    if (!target.aliases.some((a) => a.toUpperCase() === name.toUpperCase())) {
      target.aliases.push(name);
    }
  }

  // Nom canonique = orthographe de cue la plus fréquente (sinon nom déclaré).
  for (const r of resolved) {
    const cueAliases = r.aliases
      .filter((a) => (countByName.get(a.toUpperCase()) ?? 0) > 0)
      .sort((a, b) => (countByName.get(b.toUpperCase()) ?? 0) - (countByName.get(a.toUpperCase()) ?? 0));
    if (cueAliases[0]) r.canonicalName = cueAliases[0];
    r.aliases = [...new Set(r.aliases)];
  }

  return resolved;
}

function uniqueId(base: string, list: Character[]): string {
  let id = base;
  let n = 2;
  while (list.some((c) => c.id === id)) id = `${base}-${n++}`;
  return id;
}

/** Applique un mapping à la structure brute : personnages consolidés + ids remappés. */
export function applyMapping(raw: RawParse, mapping: CharacterMapping): Play {
  const characters: Character[] = [];
  const aliasToId = new Map<string, string>();
  const declaredByName = new Map(raw.declared.map((d) => [d.name.toUpperCase(), d]));

  for (const r of mapping) {
    const id = uniqueId(slugify(r.canonicalName), characters);
    const description =
      r.description ??
      r.aliases.map((a) => declaredByName.get(a.toUpperCase())?.description).find(Boolean);
    characters.push({
      id,
      canonicalName: r.canonicalName,
      aliases: [...new Set(r.aliases)],
      description: description || undefined,
    });
    for (const a of r.aliases) aliasToId.set(a.toUpperCase(), id);
  }

  const rawById = new Map(raw.play.characters.map((c) => [c.id, c]));
  const hasDeclared = raw.declared.length > 0;

  const nodes: Node[] = raw.play.nodes.map((n) => {
    if (n.type !== 'line') return n;
    const spelling = rawById.get(n.characterId)?.canonicalName ?? '';
    const id = aliasToId.get(spelling.toUpperCase());
    if (!id) return { ...n, flagged: true };
    const ch = characters.find((c) => c.id === id);
    // Personnage absent de la DISTRIBUTION ⇒ cue douteuse à relire.
    const flagged = hasDeclared && ch && !ch.description ? true : undefined;
    return { ...n, characterId: id, ...(flagged ? { flagged } : {}) };
  });

  return { title: raw.title, author: raw.author, characters, nodes };
}
