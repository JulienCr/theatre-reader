/**
 * Modèle de template de mise en page. Un template est un objet JSON sérialisable
 * qui pilote intégralement le rendu HTML/CSS (preview web et export PDF).
 *
 * Source unique de vérité pour le surlignage : `highlights` (un template peut
 * surligner un sous-ensemble de personnages, chacun avec sa couleur).
 */

export interface NameStyle {
  bold: boolean;
  caps: boolean;
  italic: boolean;
  color?: string;
  /** false ⇒ la réplique passe à la ligne sous le nom. */
  sameLineAsDialogue: boolean;
  /** Séparateur nom/réplique quand sameLineAsDialogue = true (p.ex. " : "). */
  suffix: string;
}

export interface DidascalieStyle {
  italic: boolean;
  color?: string;
  /** Indente la didascalie (paragraphe isolé uniquement). */
  indent: boolean;
  /** Masque complètement les didascalies. */
  hidden: boolean;
}

export interface HeadingStyle {
  bold: boolean;
  caps: boolean;
  align: 'left' | 'center' | 'right';
  /** Couleur du texte (sinon couleur du corps). */
  color?: string;
  /** Couleur de fond (encadré plein). */
  background?: string;
  /** Encadrer d'une bordure. */
  border?: boolean;
  borderColor?: string;
  /** Taille relative au corps (1 = taille normale). */
  fontSizeEm?: number;
}

export interface SceneHeadingStyle extends HeadingStyle {
  /** Préfixer chaque scène par l'acte courant (« ACTE II. SCENE III »). */
  showAct: boolean;
}

export type HighlightScope = 'name' | 'replique';

export interface Highlight {
  characterId: string;
  color: string;
  scope: HighlightScope;
}

export interface PageStyle {
  format: 'A4' | 'Letter';
  marginMm: number;
  fontFamily: string;
  fontSizePt: number;
  lineHeight: number;
}

export interface Template {
  id: string;
  name: string;
  /** Afficher la présentation des personnages (section DISTRIBUTION) en tête. */
  showDistribution: boolean;
  /** Forcer un saut de page après la distribution (la pièce démarre page suivante). */
  distributionPageBreak: boolean;
  /** Afficher un sommaire (actes/scènes + n° de page) au début. */
  showToc: boolean;
  /** Numéroter les pages en bas (« page x / y ») à l'export PDF. */
  pageNumbers: boolean;
  characterName: NameStyle;
  speechColor?: string;
  stageDirection: DidascalieStyle;
  inlineStageDirection: Pick<DidascalieStyle, 'italic' | 'color' | 'hidden'>;
  actHeading: HeadingStyle;
  sceneHeading: SceneHeadingStyle;
  highlights: Highlight[];
  page: PageStyle;
}

/**
 * Template MVP « lecture comédien » : nom en gras, réplique à la ligne,
 * didascalies en italique grisé. Les surlignages sont vides par défaut et
 * remplis par l'utilisateur (p.ex. Michel & Benji).
 */
export const actorReadingTemplate: Template = {
  id: 'actor-reading',
  name: 'Lecture comédien',
  showDistribution: true,
  distributionPageBreak: true,
  showToc: true,
  pageNumbers: true,
  characterName: {
    bold: true,
    caps: true,
    italic: false,
    sameLineAsDialogue: false,
    suffix: ' : ',
  },
  stageDirection: {
    italic: true,
    color: '#6b6b6b',
    indent: true,
    hidden: false,
  },
  inlineStageDirection: {
    italic: true,
    color: '#6b6b6b',
    hidden: false,
  },
  actHeading: { bold: true, caps: true, align: 'center' },
  sceneHeading: { bold: true, caps: false, align: 'left', showAct: false },
  highlights: [],
  page: {
    format: 'A4',
    marginMm: 20,
    fontFamily: "'Times New Roman', Georgia, serif",
    fontSizePt: 12,
    lineHeight: 1.5,
  },
};

/** Clone profond d'un template (pour édition sans muter le défaut). */
export function cloneTemplate(t: Template): Template {
  return JSON.parse(JSON.stringify(t)) as Template;
}
