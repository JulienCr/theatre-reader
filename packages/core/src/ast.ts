/**
 * Modèle de données interne (AST) d'une pièce de théâtre.
 *
 * Le format source éditable est du Fountain (voir `fountain.ts`), mais on
 * travaille en interne sur cet AST plus riche — notamment pour porter les
 * didascalies « en incise » au milieu d'une réplique, que Fountain ne modélise
 * pas nativement.
 */

/** Un personnage de la pièce. */
export interface Character {
  /** Identifiant stable (slug du nom canonique). */
  id: string;
  /** Nom affiché, p.ex. "GÉRALD". */
  canonicalName: string;
  /**
   * Orthographes rencontrées dans la source qui désignent ce personnage,
   * coquilles incluses (p.ex. ["GERALD", "GÉRALD PRANÇOIS"]). Sert à mapper
   * une réplique vers le bon personnage malgré les variantes.
   */
  aliases: string[];
  /** Description issue de la section DISTRIBUTION, si présente. */
  description?: string;
}

/**
 * Un fragment d'une réplique : soit du texte parlé, soit une didascalie en
 * incise (p.ex. "(s'adressant au public)").
 */
export type Segment =
  | { type: 'speech'; text: string }
  | { type: 'didascalie'; text: string };

/** En-tête d'acte, p.ex. "ACTE I." */
export interface ActNode {
  type: 'act';
  label: string;
}

/** En-tête de scène, p.ex. "SCENE I." */
export interface SceneNode {
  type: 'scene';
  label: string;
}

/** Didascalie isolée (paragraphe entre les répliques). */
export interface StageNode {
  type: 'stage';
  text: string;
  /** Marqué par l'import LLM comme incertain (à relire). */
  flagged?: boolean;
}

/** Une réplique : un personnage et la suite de ses fragments. */
export interface LineNode {
  type: 'line';
  characterId: string;
  segments: Segment[];
  /** Marqué par l'import LLM comme incertain (à relire). */
  flagged?: boolean;
}

export type Node = ActNode | SceneNode | StageNode | LineNode;

/** Une pièce complète. */
export interface Play {
  title?: string;
  author?: string;
  characters: Character[];
  nodes: Node[];
}

/** Slug stable et lisible à partir d'un nom de personnage. */
export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // retire les accents combinants
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'perso';
}

/** Texte parlé concaténé d'une réplique (sans les didascalies). */
export function speechText(line: LineNode): string {
  return line.segments
    .filter((s): s is Extract<Segment, { type: 'speech' }> => s.type === 'speech')
    .map((s) => s.text)
    .join(' ')
    .trim();
}

/**
 * Texte d'une réplique normalisé pour la synthèse / le cache TTS.
 * DOIT reproduire à l'octet près la normalisation DOM de `collectTirades`
 * (@theatre/audio-player, qui scrape le rendu puis `.replace(/\s+/g,' ').trim()`) :
 * c'est l'ancre de parité du cache audio. Toute génération/consommation de clip
 * basée sur l'AST (lecture en ligne, pré-génération en masse, export mobile) doit
 * passer par ce helper, sinon les clés de cache divergent → miss silencieux.
 */
export function speechTextForTts(line: LineNode): string {
  return speechText(line).replace(/\s+/g, ' ').trim();
}
