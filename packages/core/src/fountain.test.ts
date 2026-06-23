import { describe, expect, it } from 'vitest';
import {
  parseFountain,
  serializeFountain,
  serializeSegments,
  splitInlineSegments,
} from './fountain';
import type { Character, LineNode } from './ast';

const SAMPLE = `Title: Tout le monde se tire
Author: Richard Simon

# ACTE I.

Noir total. Le NARRATEUR arrive en avant scène et s'adresse au public.

NARRATEUR
Bonsoir Mesdames et Messieurs. (cherchant un chiffre exact) Oh on va pas se prendre la tête.

GERALD
Oui bah ça va, on a compris !

## SCENE I.

GERALD
(s'adressant au public) Je préfère ne pas répondre.
`;

describe('splitInlineSegments', () => {
  it('sépare texte parlé et didascalie en incise', () => {
    const segs = splitInlineSegments(
      'Bonsoir. (cherchant un chiffre) Oh on va pas se prendre la tête.',
    );
    expect(segs).toEqual([
      { type: 'speech', text: 'Bonsoir.' },
      { type: 'didascalie', text: 'cherchant un chiffre' },
      { type: 'speech', text: 'Oh on va pas se prendre la tête.' },
    ]);
  });

  it('gère une didascalie seule en tête', () => {
    expect(splitInlineSegments('(s\'adressant au public) Je préfère.')).toEqual([
      { type: 'didascalie', text: "s'adressant au public" },
      { type: 'speech', text: 'Je préfère.' },
    ]);
  });
});

describe('parseFountain', () => {
  const play = parseFountain(SAMPLE);

  it('extrait la page de titre', () => {
    expect(play.title).toBe('Tout le monde se tire');
    expect(play.author).toBe('Richard Simon');
  });

  it('lit les en-têtes acte/scène', () => {
    expect(play.nodes[0]).toEqual({ type: 'act', label: 'ACTE I.' });
    expect(play.nodes.some((n) => n.type === 'scene' && n.label === 'SCENE I.')).toBe(true);
  });

  it('repère une didascalie isolée', () => {
    expect(play.nodes[1]).toMatchObject({ type: 'stage' });
    expect((play.nodes[1] as { text: string }).text).toContain('Noir total');
  });

  it('crée les personnages à partir des cues', () => {
    const names = play.characters.map((c) => c.canonicalName).sort();
    expect(names).toEqual(['GERALD', 'NARRATEUR']);
  });

  it('parse une réplique avec didascalie en incise', () => {
    const narr = play.nodes.find(
      (n): n is LineNode => n.type === 'line' && play.characters.find((c) => c.id === n.characterId)?.canonicalName === 'NARRATEUR',
    )!;
    expect(narr.segments).toEqual([
      { type: 'speech', text: 'Bonsoir Mesdames et Messieurs.' },
      { type: 'didascalie', text: 'cherchant un chiffre exact' },
      { type: 'speech', text: 'Oh on va pas se prendre la tête.' },
    ]);
  });
});

describe('mapping des coquilles via alias', () => {
  it('mappe une cue mal orthographiée vers le personnage canonique', () => {
    const known: Character[] = [
      { id: 'giuseppe', canonicalName: 'GIUSEPPE', aliases: ['GIUSEPPE', 'GIUSEPPPE'] },
    ];
    const play = parseFountain('GIUSEPPPE\nMà que ! Yé pé pas !', known);
    expect(play.characters).toHaveLength(1);
    const line = play.nodes.find((n) => n.type === 'line') as LineNode;
    expect(line.characterId).toBe('giuseppe');
  });
});

describe('round-trip Fountain ↔ AST', () => {
  it('préserve la structure après parse(serialize(parse))', () => {
    const play = parseFountain(SAMPLE);
    const round = parseFountain(serializeFountain(play), play.characters);
    expect(round.title).toBe(play.title);
    expect(round.author).toBe(play.author);
    expect(round.nodes).toEqual(play.nodes);
  });
});

describe('serializeSegments', () => {
  it('réinsère les didascalies entre parenthèses', () => {
    expect(
      serializeSegments([
        { type: 'speech', text: 'Bonsoir.' },
        { type: 'didascalie', text: 'au public' },
        { type: 'speech', text: 'Je continue.' },
      ]),
    ).toBe('Bonsoir. (au public) Je continue.');
  });
});
