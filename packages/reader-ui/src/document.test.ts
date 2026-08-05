import { describe, expect, it } from 'vitest';
import { actorReadingTemplate } from '@theatre/core';
import { buildReaderDocument } from './document';

const SRC = `# ACTE I.\n\n## SCENE I.\n\nMICHEL\nBonjour à tous.\n\nBENJI\nSalut Michel.\n`;

describe('buildReaderDocument', () => {
  it('produit body + css + data cohérents', () => {
    const doc = buildReaderDocument({
      fountain: SRC,
      characters: [],
      template: actorReadingTemplate,
      storageKey: 'theatre-reader:piece',
    });
    expect(doc.body).toContain('class="play"');
    expect(doc.css.length).toBeGreaterThan(0);
    expect(doc.data.characters.map((c) => c.name)).toContain('MICHEL');
    expect(doc.data.toc.length).toBeGreaterThan(0);
    expect(doc.data.storageKey).toBe('theatre-reader:piece');
    expect(doc.data.audio).toBeUndefined(); // aucun clip → pas de bloc audio
  });

  it('expose les clips tels quels (URL opaque) et mon rôle', () => {
    const doc = buildReaderDocument({
      fountain: SRC,
      characters: [],
      template: actorReadingTemplate,
      storageKey: 'k',
      clips: { 'n-1': 'file:///local/a.mp3' },
      myCharacterId: 'michel',
    });
    expect(doc.data.audio?.clips['n-1']).toBe('file:///local/a.mp3');
    expect(doc.data.audio?.myCharacterId).toBe('michel');
  });

  it('embarque la présence des personnages par plage (option « mes scènes »)', () => {
    const doc = buildReaderDocument({
      fountain: SRC,
      characters: [],
      template: actorReadingTemplate,
      storageKey: 'k',
    });
    expect(doc.data.sceneMembers).toEqual([
      { id: 'h-0', kind: 'act', characterIds: [] },
      { id: expect.stringMatching(/^h-\d+$/), kind: 'scene', characterIds: ['michel', 'benji'] },
    ]);
    // L'id doit être celui du sommaire (pour que le runtime relie plage ↔ présence).
    const scene = doc.data.sceneMembers.find((m) => m.kind === 'scene')!;
    expect(doc.data.toc.some((e) => e.id === scene.id)).toBe(true);
  });

  it('embarque le prologue d\'un acte comme une plage à part entière', () => {
    // Sans cette entrée, le contenu placé avant la première scène d'un acte
    // échappe au filtre « mes scènes » : il reste affiché ET jouable.
    const doc = buildReaderDocument({
      fountain: `# ACTE I.\n\nNARRATEUR\nIl était une fois.\n\n## SCENE I.\n\nBENJI\nMe voilà.\n`,
      characters: [],
      template: actorReadingTemplate,
      storageKey: 'k',
    });
    const act = doc.data.sceneMembers.find((m) => m.kind === 'act')!;
    expect(act.characterIds).toEqual(['narrateur']);
    expect(doc.data.toc.some((e) => e.id === act.id)).toBe(true);
  });
});
