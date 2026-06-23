import { describe, expect, it } from 'vitest';
import type { ExtractedDoc, ExtractedLine } from './extract';
import { runHeuristics } from './heuristics';
import { applyMapping, countCues, fuzzyMerge } from './characters';

/** Construit un ExtractedDoc à partir de lignes simples (italic via préfixe "I:"). */
function doc(lines: string[]): ExtractedDoc {
  const out: ExtractedLine[] = lines.map((raw, i) => {
    const italic = raw.startsWith('I:');
    const text = italic ? raw.slice(2) : raw;
    return { page: 1, x: 90, y: 1000 - i * 10, text, italic, paragraphBreak: false };
  });
  return { numPages: 1, lines: out };
}

const SAMPLE = doc([
  'TOUT LE MONDE SE TIRE',
  'de Richard Simon',
  'DISTRIBUTION :',
  'GIUSEPPPE : Vieux beau aux moeurs archaïques.',
  'BENJI : Très intelligent, rarement l’occasion de le montrer.',
  'ACTE I.',
  'I:Noir total. Le NARRATEUR arrive en avant scène.',
  'GIUSEPPE : Mà que ! Yé pé pas !',
  'BENII : Je suis désolé de te le dire.',
  'GIUSEPPE (s’énervant) : Qué ?!! Moi tricher ?',
  'I:BREVIER commence à partir.',
]);

describe('runHeuristics', () => {
  const raw = runHeuristics(SAMPLE);

  it('extrait titre et auteur', () => {
    expect(raw.title).toBe('TOUT LE MONDE SE TIRE');
    expect(raw.author).toBe('Richard Simon');
  });

  it('lit la DISTRIBUTION (noms + descriptions)', () => {
    expect(raw.declared.map((d) => d.name)).toEqual(['GIUSEPPPE', 'BENJI']);
    expect(raw.declared[0]!.description).toContain('Vieux beau');
  });

  it('produit acte, didascalies isolées et répliques', () => {
    const types = raw.play.nodes.map((n) => n.type);
    expect(types).toContain('act');
    expect(types.filter((t) => t === 'stage')).toHaveLength(2); // Noir total + BREVIER part
    expect(types.filter((t) => t === 'line')).toHaveLength(3);
  });

  it('capture la didascalie en incise dans la cue', () => {
    const lines = raw.play.nodes.filter((n) => n.type === 'line');
    const enerve = lines.find(
      (n) => n.type === 'line' && n.segments.some((s) => s.type === 'didascalie' && s.text.includes('énervant')),
    );
    expect(enerve).toBeTruthy();
  });
});

describe('fuzzyMerge + applyMapping', () => {
  const raw = runHeuristics(SAMPLE);
  const mapping = fuzzyMerge(countCues(raw.play), raw.declared);
  const play = applyMapping(raw, mapping);

  it('regroupe les coquilles GIUSEPPPE/GIUSEPPE et BENJI/BENII', () => {
    const giuseppe = play.characters.find((c) => c.aliases.some((a) => a.includes('GIUSEPP')))!;
    expect(giuseppe.aliases).toEqual(expect.arrayContaining(['GIUSEPPE', 'GIUSEPPPE']));
    const benji = play.characters.find((c) => c.aliases.includes('BENJI'))!;
    expect(benji.aliases).toEqual(expect.arrayContaining(['BENJI', 'BENII']));
  });

  it('attache la description déclarée au personnage consolidé', () => {
    const benji = play.characters.find((c) => c.aliases.includes('BENJI'))!;
    expect(benji.description).toContain('intelligent');
  });

  it('choisit un nom canonique court (orthographe la plus fréquente)', () => {
    const giuseppe = play.characters.find((c) => c.aliases.includes('GIUSEPPE'))!;
    expect(giuseppe.canonicalName).toBe('GIUSEPPE'); // 2 occurrences vs 1
  });
});
