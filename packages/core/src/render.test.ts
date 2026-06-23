import { describe, expect, it } from 'vitest';
import { parseFountain } from './fountain';
import { buildToc, renderBody, renderCSS } from './render';
import { actorReadingTemplate, cloneTemplate } from './template';

describe('buildToc', () => {
  const src = `# ACTE I.\n\nNoir total.\n\n# ACTE II.\n\n## SCENE I.\n\nGERALD\nBonjour.\n\n## SCENE II.\n\nBENJI\nSalut.\n`;

  it('liste actes et scènes avec des id stables', () => {
    const p = parseFountain(src);
    const toc = buildToc(p, actorReadingTemplate);
    expect(toc.map((e) => e.label)).toEqual(['ACTE I.', 'ACTE II.', 'SCENE I.', 'SCENE II.']);
    expect(toc.every((e) => /^h-\d+$/.test(e.id))).toBe(true);
    // Les id correspondent aux en-têtes rendus.
    const html = renderBody(p, actorReadingTemplate);
    for (const e of toc) expect(html).toContain(`id="${e.id}"`);
  });

  it('préfixe les scènes et masque l\'acte en mode showAct', () => {
    const p = parseFountain(src);
    const tpl = cloneTemplate(actorReadingTemplate);
    tpl.sceneHeading.showAct = true;
    const toc = buildToc(p, tpl);
    // ACTE I (sans scène) conservé ; ACTE II masqué ; scènes préfixées.
    expect(toc.map((e) => e.label)).toEqual([
      'ACTE I.',
      'ACTE II. SCENE I.',
      'ACTE II. SCENE II.',
    ]);
  });
});

const SAMPLE = `# ACTE I.

MICHEL
Oh mon Dieu !

BENJI
On s'en fout des infos !

GERALD
(énervé) Bon ça suffit !
`;

describe('renderBody', () => {
  const play = parseFountain(SAMPLE);

  it('met le nom en gras et la réplique à la ligne (template comédien)', () => {
    const html = renderBody(play, actorReadingTemplate);
    expect(html).toContain('<span class="cue"');
    expect(html).toContain('<br/>'); // sameLineAsDialogue = false
    const css = renderCSS(actorReadingTemplate);
    expect(css).toContain('.cue {');
    expect(css).toMatch(/\.cue \{[^}]*font-weight: bold/);
  });

  it('rend la didascalie en incise dans un span dédié', () => {
    const html = renderBody(play, actorReadingTemplate);
    expect(html).toContain('<span class="didascalie-inline">(énervé)</span>');
  });

  it('surligne la réplique entière d\'un personnage ciblé', () => {
    const tpl = cloneTemplate(actorReadingTemplate);
    const michel = play.characters.find((c) => c.canonicalName === 'MICHEL')!;
    tpl.highlights = [{ characterId: michel.id, color: '#fff176', scope: 'replique' }];
    const html = renderBody(play, tpl);
    // La ligne de MICHEL doit porter un fond ; pas celle de BENJI.
    const michelLine = html
      .split('</p>')
      .find((chunk) => chunk.includes('MICHEL'))!;
    expect(michelLine).toContain('background-color:#fff176');
    const benjiLine = html.split('</p>').find((chunk) => chunk.includes('BENJI'))!;
    expect(benjiLine).not.toContain('background-color');
  });

  it('surligne uniquement le nom quand scope = name', () => {
    const tpl = cloneTemplate(actorReadingTemplate);
    const benji = play.characters.find((c) => c.canonicalName === 'BENJI')!;
    tpl.highlights = [{ characterId: benji.id, color: '#a5d6a7', scope: 'name' }];
    const html = renderBody(play, tpl);
    expect(html).toContain('<span class="cue" style="background-color:#a5d6a7">BENJI</span>');
  });

  it('affiche l\'acte avec chaque scène quand showAct est activé', () => {
    const p = parseFountain(`# ACTE II.\n\n## SCENE III.\n\nGERALD\nBonjour.\n`);
    const off = renderBody(p, actorReadingTemplate);
    expect(off).toMatch(/<h2 class="act"[^>]*>ACTE II\.<\/h2>/);
    expect(off).toMatch(/<h3 class="scene"[^>]*>SCENE III\.<\/h3>/);

    const tpl = cloneTemplate(actorReadingTemplate);
    tpl.sceneHeading.showAct = true;
    const on = renderBody(p, tpl);
    expect(on).toMatch(/<h3 class="scene"[^>]*>ACTE II\. SCENE III\.<\/h3>/);
    // L'en-tête d'acte autonome est masqué (redondant) car suivi d'une scène.
    expect(on).not.toMatch(/<h2 class="act"[^>]*>ACTE II\.<\/h2>/);
  });

  it('garde l\'en-tête d\'un acte sans scène même avec showAct', () => {
    const p = parseFountain(`# ACTE I.\n\nNoir total.\n`);
    const tpl = cloneTemplate(actorReadingTemplate);
    tpl.sceneHeading.showAct = true;
    const html = renderBody(p, tpl);
    expect(html).toMatch(/<h2 class="act"[^>]*>ACTE I\.<\/h2>/);
  });

  it('affiche la présentation des personnages (distribution) avec descriptions', () => {
    const p = parseFountain('# ACTE I.\n\nNARRATEUR\nBonjour.\n');
    p.characters = [
      { id: 'narrateur', canonicalName: 'NARRATEUR', aliases: ['NARRATEUR'], description: 'Extérieur à l\'histoire.' },
      { id: 'tous', canonicalName: 'TOUS', aliases: ['TOUS'] }, // sans description → exclu
    ];
    const html = renderBody(p, actorReadingTemplate);
    expect(html).toContain('class="distribution');
    expect(html).toContain('<span class="dist-name">NARRATEUR</span>');
    expect(html).toContain("Extérieur à l'histoire.");
    expect(html).not.toContain('>TOUS<'); // pas de description → absent de la distribution

    const tpl = cloneTemplate(actorReadingTemplate);
    tpl.showDistribution = false;
    expect(renderBody(p, tpl)).not.toContain('class="distribution');
  });

  it('applique fond, encadré et couleur aux en-têtes', () => {
    const tpl = cloneTemplate(actorReadingTemplate);
    tpl.actHeading = { ...tpl.actHeading, background: '#ffebc8', border: true, borderColor: '#333', align: 'center' };
    tpl.sceneHeading = { ...tpl.sceneHeading, color: '#1a3c6e', fontSizeEm: 1.2 };
    const css = renderCSS(tpl);
    expect(css).toMatch(/\.act \{[^}]*background: #ffebc8/);
    expect(css).toMatch(/\.act \{[^}]*border: 1\.5px solid #333/);
    expect(css).toMatch(/\.act \{[^}]*margin: 1\.6em auto \.8em auto/); // centré via marges auto
    expect(css).toMatch(/\.scene \{[^}]*color: #1a3c6e/);
    expect(css).toMatch(/\.scene \{[^}]*font-size: 1\.2em/);
  });

  it('échappe le HTML du texte', () => {
    const play2 = parseFountain('NARRATEUR\nIl a dit <bonjour> & adieu.');
    const html = renderBody(play2, actorReadingTemplate);
    expect(html).toContain('&lt;bonjour&gt; &amp; adieu');
  });
});
