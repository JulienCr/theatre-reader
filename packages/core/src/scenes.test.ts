import { describe, expect, it } from 'vitest';
import { slugify } from './ast';
import { parseFountain } from './fountain';
import { sceneMembers, filterScenesByRoles } from './scenes';
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

const GERALD = slugify('GERALD');
const BENJI = slugify('BENJI');
const MICHEL = slugify('MICHEL');

describe('sceneMembers', () => {
  const play = parseFountain(SRC);

  it('liste les personnages présents par scène, id = h-<index> comme buildToc', () => {
    const members = sceneMembers(play);
    expect(members.map((m) => m.characterIds)).toEqual([[GERALD, BENJI], [MICHEL], [GERALD]]);
    const sceneIds = buildToc(play, actorReadingTemplate).filter((e) => e.scene).map((e) => e.id);
    expect(members.map((m) => m.id)).toEqual(sceneIds);
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

  it('conserve le contenu hors-scène (didascalie avant la première scène)', () => {
    const filtered = filterScenesByRoles(play, [MICHEL]);
    expect(filtered.nodes.some((n) => n.type === 'stage' && n.text === 'Noir total.')).toBe(true);
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
});
