import { describe, expect, it } from 'vitest';
import { slugify, type Node, type Play } from './ast';
import { parseFountain } from './fountain';
import {
  LEAD_RANGE_ID,
  sceneMembers,
  sceneVisibility,
  filterScenesByRoles,
  type EmbeddedSceneMember,
  type SceneVisibility,
} from './scenes';
import { buildToc } from './render';
import { buildNodeIds } from './notes';
import { actorReadingTemplate, cloneTemplate } from './template';

const SRC = `# ACTE I.

Noir total.

## SCENE I.

GERALD
Bonjour.

BENJI
Salut.

## SCENE II.

MICHEL
Seul ici.

# ACTE II.

## SCENE I.

GERALD
Retour.
`;

/**
 * Structure de la pièce réelle qui a révélé le bug : l'ACTE I porte 85 répliques
 * AVANT sa première scène. Réduite ici à l'essentiel, elle en garde la forme.
 */
const PROLOGUE_SRC = `# ACTE I.

Le rideau se lève.

NARRATEUR
Il était une fois.

GERALD
Bonjour.

## SCENE I.

BENJI
Me voilà.
`;

const GERALD = slugify('GERALD');
const BENJI = slugify('BENJI');
const MICHEL = slugify('MICHEL');
const NARRATEUR = slugify('NARRATEUR');

describe('sceneMembers', () => {
  const play = parseFountain(SRC);

  it('liste les personnages par plage, ids de scène identiques à buildToc', () => {
    const members = sceneMembers(play);
    // Un acte porte les personnages de son PROLOGUE seul, pas ceux de ses scènes :
    // ici les deux actes n'ont que « Noir total. » et rien du tout.
    expect(members.map((m) => [m.kind, m.characterIds])).toEqual([
      ['act', []],
      ['scene', [GERALD, BENJI]],
      ['scene', [MICHEL]],
      ['act', []],
      ['scene', [GERALD]],
    ]);
    const sceneIds = buildToc(play, actorReadingTemplate)
      .filter((e) => e.scene)
      .map((e) => e.id);
    expect(members.filter((m) => m.kind === 'scene').map((m) => m.id)).toEqual(sceneIds);
  });

  it('le prologue d\'un acte porte ses propres personnages', () => {
    const members = sceneMembers(parseFountain(PROLOGUE_SRC));
    expect(members.map((m) => [m.id, m.kind, m.characterIds])).toEqual([
      ['h-0', 'act', [NARRATEUR, GERALD]],
      ['h-4', 'scene', [BENJI]],
    ]);
  });

  it('le contenu avant tout en-tête forme une plage de tête', () => {
    const members = sceneMembers(parseFountain('NARRATEUR\nAvant tout.\n\n# ACTE I.\n\n## SCENE I.\n\nBENJI\nIci.\n'));
    expect(members[0]).toEqual({ id: LEAD_RANGE_ID, kind: 'lead', characterIds: [NARRATEUR] });
  });

  it('pas de plage de tête quand la pièce ouvre sur un en-tête', () => {
    expect(sceneMembers(play).some((m) => m.id === LEAD_RANGE_ID)).toBe(false);
  });
});

describe('sceneVisibility', () => {
  const visibility = (src: string, roles: string[]): SceneVisibility =>
    sceneVisibility(sceneMembers(parseFountain(src)), roles);

  it('masque le prologue d\'un acte gardé SANS masquer son titre', () => {
    // Le bug rapporté : les répliques du narrateur en tête d'ACTE I restaient
    // affichées et jouables alors que BENJI n'y joue pas.
    const v = visibility(PROLOGUE_SRC, [BENJI]);
    expect(v.ranges.has('h-0')).toBe(true);
    expect(v.headings.has('h-0')).toBe(false);
    expect(v.ranges.has('h-4')).toBe(false);
  });

  it('masque titre ET contenu d\'un acte sans aucune scène où je ne joue pas', () => {
    const v = visibility('# ACTE I.\n\nNARRATEUR\nBla.\n\n# ACTE II.\n\n## SCENE I.\n\nBENJI\nIci.\n', [BENJI]);
    expect(v.headings.has('h-0')).toBe(true);
    expect(v.ranges.has('h-0')).toBe(true);
    expect(v.headings.has('h-2')).toBe(false); // ACTE II : sa scène survit
  });

  it('garde le prologue quand j\'y joue', () => {
    // GERALD parle dans le prologue : il reste, même si la scène de BENJI tombe.
    const v = visibility(PROLOGUE_SRC, [GERALD]);
    expect(v.ranges.has('h-0')).toBe(false);
    expect(v.headings.has('h-0')).toBe(false);
    expect(v.headings.has('h-4')).toBe(true);
  });

  it('garde un prologue purement didascalique dans un acte gardé', () => {
    // « Noir total. » n'est à personne : il suit son acte au lieu de tomber.
    const v = visibility(SRC, [MICHEL]);
    expect(v.ranges.has('h-0')).toBe(false);
  });

  it('masque une tête de pièce bavarde où je ne joue pas, sans en-tête à masquer', () => {
    const src = 'NARRATEUR\nAvant tout.\n\n# ACTE I.\n\n## SCENE I.\n\nBENJI\nIci.\n';
    const v = visibility(src, [BENJI]);
    expect(v.ranges.has(LEAD_RANGE_ID)).toBe(true);
    expect(v.headings.has(LEAD_RANGE_ID)).toBe(false);
  });

  it('garde une tête de pièce sans réplique', () => {
    const src = 'Une didascalie seule.\n\n# ACTE I.\n\n## SCENE I.\n\nBENJI\nIci.\n';
    expect(visibility(src, [BENJI]).ranges.has(LEAD_RANGE_ID)).toBe(false);
  });

  it('masque une scène hors acte comme avant', () => {
    const v = visibility('## SCENE I.\n\nGERALD\nSalut.\n\n## SCENE II.\n\nBENJI\nIci.\n', [BENJI]);
    expect(v.headings.has('h-0')).toBe(true);
    expect(v.ranges.has('h-0')).toBe(true);
  });

  it('roleIds vide → rien de masqué (chemin de démasquage)', () => {
    const v = visibility(SRC, []);
    expect(v.headings.size).toBe(0);
    expect(v.ranges.size).toBe(0);
  });

  it('invariant : headings ⊆ ranges', () => {
    for (const roles of [[GERALD], [BENJI], [MICHEL], [NARRATEUR]]) {
      for (const src of [SRC, PROLOGUE_SRC]) {
        const v = visibility(src, roles);
        for (const id of v.headings) expect(v.ranges.has(id)).toBe(true);
      }
    }
  });

  it('traite une donnée d\'export antérieure à `kind` comme des scènes', () => {
    // `EmbeddedSceneMember` rend `kind` optionnel : la forme d'un vieil export
    // se construit sans tricher avec le typage.
    const legacy: EmbeddedSceneMember[] = sceneMembers(parseFountain(SRC))
      .filter((m) => m.kind === 'scene')
      .map(({ id, characterIds }) => ({ id, characterIds }));
    const v = sceneVisibility(legacy, [MICHEL]);
    expect(v.headings.has('h-2')).toBe(true); // SCENE I (GERALD/BENJI)
    expect(v.headings.has('h-5')).toBe(false); // SCENE II (MICHEL)
  });
});

describe('filterScenesByRoles', () => {
  const play = parseFountain(SRC);

  const labels = (p: ReturnType<typeof parseFountain>): string[] =>
    buildToc(p, actorReadingTemplate).map((e) => e.label);

  it('garde les scènes où le rôle joue, conserve les actes non vidés', () => {
    const filtered = filterScenesByRoles(play, [GERALD]);
    // SCENE II (MICHEL seul) tombe ; les deux actes ont une scène survivante.
    expect(labels(filtered)).toEqual(['ACTE I.', 'SCENE I.', 'ACTE II.', 'SCENE I.']);
  });

  it('supprime un acte dont plus aucune scène ne survit', () => {
    const filtered = filterScenesByRoles(play, [MICHEL]);
    // Seule SCENE II (Acte I) survit ; ACTE II entier disparaît.
    expect(labels(filtered)).toEqual(['ACTE I.', 'SCENE II.']);
  });

  it('unit les rôles (aucune scène exclue → référence inchangée)', () => {
    expect(filterScenesByRoles(play, [GERALD, MICHEL, BENJI])).toBe(play);
  });

  it('roleIds vide → pièce inchangée (même référence)', () => {
    expect(filterScenesByRoles(play, [])).toBe(play);
  });

  it('conserve le contenu hors-scène d\'un acte partiellement gardé', () => {
    // Acte I garde SCENE II (MICHEL) → sa didascalie d'ouverture reste.
    const filtered = filterScenesByRoles(play, [MICHEL]);
    expect(filtered.nodes.some((n) => n.type === 'stage' && n.text === 'Noir total.')).toBe(true);
  });

  it('retire tout un acte muet, didascalie d\'ouverture comprise (parité mobile)', () => {
    const p = parseFountain(
      '# ACTE I.\n\n## SCENE I.\n\nGERALD\nSalut.\n\n# ACTE II.\n\nLe rideau se lève.\n\n## SCENE I.\n\nBENJI\nBonjour.\n',
    );
    const filtered = filterScenesByRoles(p, [GERALD]);
    // ACTE II entier tombe (GERALD absent), y compris « Le rideau se lève. ».
    expect(buildToc(filtered, actorReadingTemplate).map((e) => e.label)).toEqual(['ACTE I.', 'SCENE I.']);
    expect(filtered.nodes.some((n) => n.type === 'stage' && n.text === 'Le rideau se lève.')).toBe(false);
  });

  it('garde les data-nid des scènes survivantes (notes/audio restent ancrés)', () => {
    const fullIds = buildNodeIds(play);
    const iFull = play.nodes.findIndex((n) => n.type === 'line' && n.characterId === MICHEL);
    const filtered = filterScenesByRoles(play, [MICHEL]);
    const filteredIds = buildNodeIds(filtered);
    const iFilt = filtered.nodes.findIndex((n) => n.type === 'line' && n.characterId === MICHEL);
    expect(filteredIds[iFilt]).toBe(fullIds[iFull]);
  });

  it('reste cohérent avec buildToc en mode showAct', () => {
    const tpl = cloneTemplate(actorReadingTemplate);
    tpl.sceneHeading.showAct = true;
    const filtered = filterScenesByRoles(play, [GERALD]);
    // ACTE I. n'est pas suivi immédiatement d'une scène (« Noir total. » s'intercale)
    // → non masqué ; ACTE II. l'est. Scènes préfixées par leur acte.
    expect(buildToc(filtered, tpl).map((e) => e.label)).toEqual([
      'ACTE I.',
      'ACTE I. SCENE I.',
      'ACTE II. SCENE I.',
    ]);
  });

  it('supprime le prologue d\'un acte dont l\'en-tête survit', () => {
    const filtered = filterScenesByRoles(parseFountain(PROLOGUE_SRC), [BENJI]);
    expect(labels(filtered)).toEqual(['ACTE I.', 'SCENE I.']);
    expect(filtered.nodes.some((n) => n.type === 'line' && n.characterId === NARRATEUR)).toBe(false);
    expect(filtered.nodes.some((n) => n.type === 'stage')).toBe(false);
  });

  it('filtre le contenu placé avant tout en-tête', () => {
    const p = parseFountain('NARRATEUR\nAvant tout.\n\n# ACTE I.\n\n## SCENE I.\n\nBENJI\nIci.\n');
    const filtered = filterScenesByRoles(p, [BENJI]);
    expect(filtered.nodes.some((n) => n.type === 'line' && n.characterId === NARRATEUR)).toBe(false);
  });

  /**
   * Le seul test qui empêche la re-divergence web/mobile — celle qui a produit le
   * bug. On reproduit ici le walk du lecteur mobile (hériter de la plage ouverte
   * par le dernier en-tête) à partir de la donnée EMBARQUÉE, et on exige le même
   * résultat que le filtre AST du web.
   */
  it('parité : le walk mobile sur sceneMembers garde exactement les nœuds du filtre web', () => {
    const walkMobile = (p: Play, v: SceneVisibility): Node[] => {
      const out: Node[] = [];
      let current = LEAD_RANGE_ID;
      for (let i = 0; i < p.nodes.length; i++) {
        const n = p.nodes[i]!;
        if (n.type === 'act' || n.type === 'scene') {
          current = `h-${i}`;
          if (!v.headings.has(current)) out.push(n);
          continue;
        }
        if (!v.ranges.has(current)) out.push(n);
      }
      return out;
    };

    for (const src of [SRC, PROLOGUE_SRC]) {
      const p = parseFountain(src);
      for (const roles of [[GERALD], [BENJI], [MICHEL], [NARRATEUR], [GERALD, MICHEL]]) {
        const v = sceneVisibility(sceneMembers(p), roles);
        expect(walkMobile(p, v)).toEqual(filterScenesByRoles(p, roles).nodes);
      }
    }
  });
});
