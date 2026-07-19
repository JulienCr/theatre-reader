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
});
