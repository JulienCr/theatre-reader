/**
 * Parseur heuristique : transforme les lignes extraites du PDF en structure de
 * pièce (AST core), en s'appuyant sur les conventions observées :
 *   - titre/auteur en préambule (auteur = ligne "de …") ;
 *   - section DISTRIBUTION (NOM EN MAJUSCULES : description) → personnages déclarés ;
 *   - en-têtes "ACTE I.", "ACTE II. SCENE I." ;
 *   - répliques "NOM : texte" (nom en majuscules en début de ligne) ;
 *   - didascalies = lignes en italique (isolées) ou texte entre parenthèses (incise).
 *
 * Chaque orthographe de cue rencontrée devient un personnage « brut » distinct ;
 * la consolidation des coquilles (GIUSEPPPE→GIUSEPPE, BENII→BENJI) est faite
 * ensuite par l'étape de résolution (LLM ou fuzzy), cf. characters.ts / llm.ts.
 */

import {
  Character,
  LineNode,
  Node,
  Play,
  Segment,
  slugify,
  splitInlineSegments,
} from '@theatre/core';
import { ExtractedDoc, ExtractedLine } from './extract';

export interface DeclaredCharacter {
  name: string;
  description: string;
}

export interface RawParse {
  title?: string;
  author?: string;
  /** Personnages annoncés dans la DISTRIBUTION (noms + descriptions). */
  declared: DeclaredCharacter[];
  /** Structure parsée ; les personnages portent les orthographes brutes des cues. */
  play: Play;
}

const CUE_RE = /^([^:()]{1,40}?)\s*(?:\(([^)]*)\))?\s*:\s*(.*)$/;
const ACT_RE = /\bACTE\s+[IVXLCDM\d]+\b\.?/i;
const SCENE_RE = /\bSC[EÈ]NE\s+[IVXLCDM\d]+\b\.?/i;

/** Une chaîne ressemble-t-elle à un nom de personnage (majuscules, pas de minuscule) ? */
function isUpperName(s: string): boolean {
  const t = s.trim();
  if (!t || t.length > 40) return false;
  if (!/[A-ZÀ-Þ]/.test(t)) return false;
  if (/[a-zà-ÿ]/.test(t)) return false;
  return true;
}

interface Cue {
  name: string;
  paren?: string;
  rest: string;
}

function matchCue(text: string): Cue | null {
  const m = CUE_RE.exec(text.trim());
  if (!m) return null;
  const name = m[1]!.trim();
  if (!isUpperName(name)) return null;
  return { name, paren: m[2]?.trim() || undefined, rest: m[3] ?? '' };
}

interface Heading {
  act?: string;
  scene?: string;
}

function matchHeading(text: string): Heading | null {
  const t = text.trim();
  const actM = ACT_RE.exec(t);
  const sceneM = SCENE_RE.exec(t);
  if (!actM && !sceneM) return null;
  let rem = t;
  if (actM) rem = rem.replace(actM[0], '');
  if (sceneM) rem = rem.replace(sceneM[0], '');
  rem = rem.replace(/[.\s]/g, '');
  if (rem.length > 0) return null;
  return { act: actM?.[0].trim(), scene: sceneM?.[0].trim() };
}

function parseDistribution(lines: ExtractedLine[]): DeclaredCharacter[] {
  const declared: DeclaredCharacter[] = [];
  let cur: DeclaredCharacter | null = null;
  for (const l of lines) {
    const t = l.text.trim();
    if (/^DISTRIBUTION\b/i.test(t)) continue;
    const m = /^([^:()]{1,40}?)\s*:\s*(.*)$/.exec(t);
    if (m && isUpperName(m[1]!.trim())) {
      if (cur) declared.push(cur);
      cur = { name: m[1]!.trim(), description: m[2]!.trim() };
    } else if (cur) {
      cur.description += ' ' + t;
    }
  }
  if (cur) declared.push(cur);
  return declared.map((d) => ({ name: d.name, description: d.description.trim() }));
}

export function runHeuristics(doc: ExtractedDoc): RawParse {
  const lines = doc.lines;

  const distIdx = lines.findIndex((l) => /^DISTRIBUTION\b/i.test(l.text.trim()));
  let firstHeadingIdx = lines.findIndex(
    (l, i) => (distIdx === -1 || i > distIdx) && matchHeading(l.text) !== null,
  );
  if (firstHeadingIdx === -1) firstHeadingIdx = distIdx === -1 ? 0 : lines.length;

  // Préambule : titre + auteur.
  const preamble = lines.slice(0, distIdx === -1 ? Math.min(firstHeadingIdx, 4) : distIdx);
  let title: string | undefined = preamble[0]?.text.trim();
  let author: string | undefined;
  for (const l of preamble) {
    const m = /^de\s+(.+)$/i.exec(l.text.trim());
    if (m) {
      author = m[1]!.trim();
      break;
    }
  }

  // Distribution.
  const declared =
    distIdx === -1 ? [] : parseDistribution(lines.slice(distIdx, firstHeadingIdx));

  // Corps.
  const characters: Character[] = [];
  const charByName = new Map<string, Character>();
  const getChar = (name: string): Character => {
    const key = name.toUpperCase();
    let c = charByName.get(key);
    if (!c) {
      c = { id: uniqueId(slugify(name), characters), canonicalName: name, aliases: [name] };
      characters.push(c);
      charByName.set(key, c);
    }
    return c;
  };

  const nodes: Node[] = [];
  let lastAct: string | undefined;
  let turnChar: Character | null = null;
  let turnParen: string | undefined;
  let turnText: string[] = [];
  let stageLines: string[] = [];

  const flushTurn = () => {
    if (!turnChar) return;
    const segments: Segment[] = [];
    if (turnParen) segments.push({ type: 'didascalie', text: turnParen });
    segments.push(...splitInlineSegments(turnText.join(' ').trim()));
    const node: LineNode = { type: 'line', characterId: turnChar.id, segments };
    nodes.push(node);
    turnChar = null;
    turnParen = undefined;
    turnText = [];
  };
  const flushStage = () => {
    const text = stageLines.join(' ').trim();
    if (text) nodes.push({ type: 'stage', text });
    stageLines = [];
  };
  const flushAll = () => {
    flushTurn();
    flushStage();
  };

  for (let i = firstHeadingIdx; i < lines.length; i++) {
    const line = lines[i]!;
    const text = line.text.trim();
    if (!text) continue;

    const heading = matchHeading(text);
    if (heading) {
      flushAll();
      // La source répète l'acte avant chaque scène : on ne le ré-émet qu'au changement.
      if (heading.act && heading.act !== lastAct) {
        nodes.push({ type: 'act', label: heading.act });
        lastAct = heading.act;
      }
      if (heading.scene) nodes.push({ type: 'scene', label: heading.scene });
      continue;
    }

    const cue = matchCue(text);
    if (cue) {
      flushAll();
      turnChar = getChar(cue.name);
      turnParen = cue.paren;
      turnText = cue.rest ? [cue.rest] : [];
      continue;
    }

    if (line.italic) {
      // Cas d'une didascalie en incise qui passe à la ligne : tant que la
      // parenthèse ouverte dans la réplique courante n'est pas refermée, la
      // ligne italique est sa suite, pas une didascalie isolée.
      if (turnChar && parenBalance(turnText.join(' ')) > 0) {
        turnText.push(text);
        continue;
      }
      // Sinon : didascalie isolée — ferme une éventuelle réplique, accumule.
      flushTurn();
      stageLines.push(text);
      continue;
    }

    // Ligne courante non balisée : continuation de réplique, sinon didascalie.
    if (turnChar) {
      turnText.push(text);
    } else {
      stageLines.push(text);
    }
  }
  flushAll();

  return {
    title,
    author,
    declared,
    play: { title, author, characters, nodes },
  };
}

/** Solde de parenthèses ouvertes (positif ⇒ une incise n'est pas refermée). */
function parenBalance(text: string): number {
  let n = 0;
  for (const ch of text) {
    if (ch === '(') n++;
    else if (ch === ')') n = Math.max(0, n - 1);
  }
  return n;
}

function uniqueId(base: string, list: Character[]): string {
  let id = base;
  let n = 2;
  while (list.some((c) => c.id === id)) id = `${base}-${n++}`;
  return id;
}
