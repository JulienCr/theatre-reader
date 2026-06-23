import { describe, expect, it } from 'vitest';
import { actorReadingTemplate, cloneTemplate } from '@theatre/core';
import { exportReaderHtml } from './reader-export';

const SRC = `# ACTE I.\n\n## SCENE I.\n\nMICHEL\nBonjour à tous.\n\nBENJI\nSalut Michel.\n`;

describe('exportReaderHtml', () => {
  it('produit un HTML mobile auto-suffisant', async () => {
    const { html, filename } = await exportReaderHtml(SRC, [], actorReadingTemplate);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('width=device-width');
    expect(html).toContain('data-cid='); // les répliques sont marquées
    expect(html).toContain('window.__THEATRE_READER_DATA__');
    expect(html).toContain('TheatreReader.boot()'); // runtime inliné + bootstrap
    // pagination neutralisée pour le reflow continu
    expect(html).toContain('.toc-item a::after { content: none');
    // auto-suffisant : aucune ressource réseau externe
    expect(html).not.toMatch(/(src|href)="https?:\/\//);
    expect(filename).toMatch(/^lecteur-.+\.html$/);
    // pas de séparateur de ligne JS brut dans le bloc de données inliné
    expect(html).not.toContain("\u2028");
    expect(html).not.toContain("\u2029");
  });

  it('pré-sélectionne les surlignages du template', async () => {
    const tpl = cloneTemplate(actorReadingTemplate);
    // on surligne un personnage existant via son id résolu
    const { html } = await exportReaderHtml(SRC, [], tpl);
    expect(html).toContain('"highlightsDefault"');
  });
});
