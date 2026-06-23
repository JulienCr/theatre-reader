/**
 * Conversion entre le format source Fountain (texte éditable) et l'AST interne.
 *
 * On n'utilise pas `fountain-js` : cette lib produit des tokens/HTML, pas notre
 * AST, et ne modélise ni les didascalies en incise, ni la table des personnages
 * (alias/coquilles). L'adapter reviendrait à re-parser sa sortie. Un parseur
 * ciblé sur notre sous-ensemble est plus simple à tester et à maintenir.
 *
 * Dialecte supporté :
 *   - Page de titre Fountain : `Title:` / `Author:` en tête, terminée par une
 *     ligne vide.
 *   - Sections : `# ACTE I.` (acte) et `## SCENE I.` (scène).
 *   - Réplique : ligne de cue en MAJUSCULES (ou alias connu) seule, suivie des
 *     lignes de dialogue jusqu'à la ligne vide.
 *   - Didascalie isolée : tout autre paragraphe.
 *   - Didascalie en incise : `(...)` à l'intérieur d'une ligne de dialogue
 *     (convention compatible Fountain : du texte entre parenthèses).
 */

import { Character, LineNode, Node, Play, Segment, slugify } from './ast';

const TITLE_KEY_RE = /^(Title|Titre|Author|Auteur|Authors|Credit|Source|Draft date|Contact)\s*:\s*(.*)$/i;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;

/** Une ligne est-elle une cue de personnage (MAJUSCULES) ? */
function looksLikeCue(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 60) return false;
  if (HEADING_RE.test(t)) return false;
  // Au moins une lettre, et aucune minuscule (accents inclus).
  if (!/[A-ZÀ-Þ]/.test(t)) return false;
  if (/[a-zà-ÿ]/.test(t)) return false;
  return true;
}

/** Découpe une ligne de dialogue en segments parlé / didascalie en incise. */
export function splitInlineSegments(text: string): Segment[] {
  const segments: Segment[] = [];
  const re = /\(([^)]*)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const before = text.slice(last, m.index).trim();
    if (before) segments.push({ type: 'speech', text: before });
    const inner = m[1]!.trim();
    if (inner) segments.push({ type: 'didascalie', text: inner });
    last = m.index + m[0].length;
  }
  const tail = text.slice(last).trim();
  if (tail) segments.push({ type: 'speech', text: tail });
  return segments;
}

interface CharIndex {
  byAlias: Map<string, Character>;
  list: Character[];
}

function buildCharIndex(known: Character[]): CharIndex {
  const byAlias = new Map<string, Character>();
  for (const c of known) {
    byAlias.set(c.canonicalName.toUpperCase(), c);
    for (const a of c.aliases) byAlias.set(a.toUpperCase(), c);
  }
  return { byAlias, list: [...known] };
}

/** Résout une cue vers un personnage (existant ou créé à la volée). */
function resolveCharacter(cue: string, idx: CharIndex): Character {
  const key = cue.trim().toUpperCase();
  const found = idx.byAlias.get(key);
  if (found) return found;
  const created: Character = {
    id: uniqueId(slugify(cue), idx.list),
    canonicalName: cue.trim(),
    aliases: [cue.trim()],
  };
  idx.list.push(created);
  idx.byAlias.set(key, created);
  return created;
}

function uniqueId(base: string, list: Character[]): string {
  let id = base;
  let n = 2;
  while (list.some((c) => c.id === id)) id = `${base}-${n++}`;
  return id;
}

/** Parse un texte Fountain (+ personnages connus) en AST. */
export function parseFountain(text: string, knownCharacters: Character[] = []): Play {
  const normalized = text.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const idx = buildCharIndex(knownCharacters);

  let title: string | undefined;
  let author: string | undefined;
  let cursor = 0;

  // Page de titre : uniquement si la première ligne non vide est une clé connue.
  const firstNonEmpty = lines.findIndex((l) => l.trim() !== '');
  if (firstNonEmpty !== -1 && TITLE_KEY_RE.test(lines[firstNonEmpty]!.trim())) {
    let i = firstNonEmpty;
    for (; i < lines.length; i++) {
      const line = lines[i]!;
      if (line.trim() === '') break;
      const m = TITLE_KEY_RE.exec(line.trim());
      if (!m) continue;
      const key = m[1]!.toLowerCase();
      const value = m[2]!.trim();
      if (key.startsWith('tit')) title = value;
      else if (key.startsWith('aut')) author = value;
    }
    cursor = i;
  }

  const nodes: Node[] = [];

  // Découpe le reste en blocs séparés par des lignes vides.
  let i = cursor;
  while (i < lines.length) {
    if (lines[i]!.trim() === '') {
      i++;
      continue;
    }
    const block: string[] = [];
    while (i < lines.length && lines[i]!.trim() !== '') {
      block.push(lines[i]!);
      i++;
    }
    parseBlock(block, idx, nodes);
  }

  return { title, author, characters: idx.list, nodes };
}

function parseBlock(block: string[], idx: CharIndex, nodes: Node[]): void {
  const first = block[0]!.trim();

  // En-tête acte / scène.
  const heading = HEADING_RE.exec(first);
  if (heading) {
    const level = heading[1]!.length;
    const label = heading[2]!.trim();
    nodes.push(level === 1 ? { type: 'act', label } : { type: 'scene', label });
    // Un éventuel reste du bloc est traité comme didascalie.
    if (block.length > 1) {
      const rest = block.slice(1).join(' ').trim();
      if (rest) nodes.push({ type: 'stage', text: rest });
    }
    return;
  }

  // Réplique : première ligne = cue.
  if (looksLikeCue(first)) {
    const character = resolveCharacter(first, idx);
    const dialogue = block.slice(1).join(' ').trim();
    const segments = dialogue ? splitInlineSegments(dialogue) : [];
    const node: LineNode = { type: 'line', characterId: character.id, segments };
    nodes.push(node);
    return;
  }

  // Sinon : didascalie isolée.
  nodes.push({ type: 'stage', text: block.join(' ').trim() });
}

/** Sérialise une réplique en chaîne de dialogue Fountain (incise = `(...)`). */
export function serializeSegments(segments: Segment[]): string {
  return segments
    .map((s) => (s.type === 'didascalie' ? `(${s.text})` : s.text))
    .join(' ')
    .trim();
}

/** Sérialise un AST en texte Fountain. */
export function serializeFountain(play: Play): string {
  const out: string[] = [];

  if (play.title) out.push(`Title: ${play.title}`);
  if (play.author) out.push(`Author: ${play.author}`);
  if (out.length) out.push('');

  const byId = new Map(play.characters.map((c) => [c.id, c]));

  for (const node of play.nodes) {
    switch (node.type) {
      case 'act':
        out.push(`# ${node.label}`, '');
        break;
      case 'scene':
        out.push(`## ${node.label}`, '');
        break;
      case 'stage':
        out.push(node.text, '');
        break;
      case 'line': {
        const name = byId.get(node.characterId)?.canonicalName ?? node.characterId;
        out.push(name);
        const dialogue = serializeSegments(node.segments);
        if (dialogue) out.push(dialogue);
        out.push('');
        break;
      }
    }
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
