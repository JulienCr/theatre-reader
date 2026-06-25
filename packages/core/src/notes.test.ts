import { describe, expect, it } from 'vitest';
import { buildNodeIds, resolveNote } from './notes';
import { parseFountain } from './fountain';

describe('buildNodeIds', () => {
  it('garde le même id quand on insère une réplique au-dessus', () => {
    const a = parseFountain(`MICHEL\nBonjour.\n\nBENJI\nSalut.\n`);
    const b = parseFountain(`TOUS\nIntro.\n\nMICHEL\nBonjour.\n\nBENJI\nSalut.\n`);
    const ia = buildNodeIds(a);
    const ib = buildNodeIds(b);
    const mA = a.nodes.findIndex((n) => n.type === 'line' && n.characterId === 'michel');
    const mB = b.nodes.findIndex((n) => n.type === 'line' && n.characterId === 'michel');
    expect(ia[mA]).toBe(ib[mB]); // l'insertion au-dessus n'a pas changé l'id
  });

  it('départage par ordinal deux nœuds au contenu identique', () => {
    const p = parseFountain(`MICHEL\nOui.\n\nMICHEL\nOui.\n`);
    const ids = buildNodeIds(p);
    const lineIds = p.nodes
      .map((n, i) => ({ n, id: ids[i]! }))
      .filter((x) => x.n.type === 'line')
      .map((x) => x.id);
    expect(lineIds[0]).not.toBe(lineIds[1]);
  });
});

describe('resolveNote', () => {
  const text = 'MICHEL : Bonjour à tous.';
  it('résout quand la citation correspond toujours', () => {
    // "Bonjour" commence à l'index 9
    expect(resolveNote(text, { start: 9, end: 16, quote: 'Bonjour' })).toEqual({ start: 9, end: 16 });
  });
  it('renvoie null (orphelin) si la citation ne correspond plus', () => {
    expect(resolveNote(text, { start: 9, end: 16, quote: 'Bonsoir' })).toBeNull();
  });
  it('renvoie null si les bornes sont hors limites ou vides', () => {
    expect(resolveNote(text, { start: 9, end: 99, quote: 'Bonjour' })).toBeNull();
    expect(resolveNote(text, { start: 9, end: 9, quote: '' })).toBeNull();
    expect(resolveNote(text, { start: -1, end: 3, quote: 'MIC' })).toBeNull();
  });
});
