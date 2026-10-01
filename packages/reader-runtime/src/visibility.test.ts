// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { LEAD_RANGE_ID, type SceneVisibility } from '@theatre/core';
import { applyVisibility, lineFilterHidden, rangeIndex } from './visibility';

/**
 * Imite la sortie de `renderBody` : préambule sans `data-nid`, puis les nœuds de
 * la pièce, à plat, chacun avec son `data-nid`.
 */
const BODY =
  '<article class="play">' +
  '<header class="play-header"><h1 class="title">Pièce</h1></header>' +
  '<section class="distribution"><h2 class="dist-heading">Distribution</h2></section>' +
  '<nav class="toc"><h2 class="toc-heading">Sommaire</h2></nav>' +
  '<p class="line" data-cid="narrateur" data-nid="lead#0">Avant tout.</p>' +
  '<h2 class="act" id="h-1" data-nid="a1#0">ACTE I.</h2>' +
  '<p class="line" data-cid="narrateur" data-nid="p1#0">Prologue.</p>' +
  '<p class="line" data-cid="gerald" data-nid="p2#0">Encore.</p>' +
  '<h3 class="scene" id="h-4" data-nid="s1#0">SCENE I.</h3>' +
  '<p class="line" data-cid="benji" data-nid="b1#0">Me voilà.</p>' +
  '<h3 class="scene" id="h-6" data-nid="s2#0">SCENE II.</h3>' +
  '<p class="line" data-cid="michel" data-nid="m1#0">Seul.</p>' +
  '</article>';

const visibility = (headings: string[], ranges: string[]): SceneVisibility => ({
  headings: new Set(headings),
  ranges: new Set(ranges),
});

const NO_LINES: ReadonlySet<string> = new Set();

let play: HTMLElement;

const hidden = (nid: string): boolean =>
  play.querySelector<HTMLElement>(`[data-nid="${nid}"]`)!.classList.contains('scene--hidden');

const preambleTouched = (): boolean =>
  ['header.play-header', 'section.distribution', 'nav.toc'].some((sel) =>
    play.querySelector<HTMLElement>(sel)!.classList.contains('scene--hidden'),
  );

beforeEach(() => {
  document.body.innerHTML = BODY;
  play = document.querySelector<HTMLElement>('.play')!;
});

describe('applyVisibility (verdict de scène)', () => {
  it('masque le prologue d\'un acte sans masquer son en-tête', () => {
    applyVisibility(play, visibility([], ['h-1']), NO_LINES);
    expect(hidden('a1#0')).toBe(false); // le titre d'acte reste un repère
    expect(hidden('p1#0')).toBe(true);
    expect(hidden('p2#0')).toBe(true);
    expect(hidden('s1#0')).toBe(false); // la plage s'arrête au prochain en-tête
    expect(hidden('b1#0')).toBe(false);
  });

  it('masque en-tête et contenu quand l\'id est dans headings', () => {
    applyVisibility(play, visibility(['h-6'], ['h-6']), NO_LINES);
    expect(hidden('s2#0')).toBe(true);
    expect(hidden('m1#0')).toBe(true);
    expect(hidden('b1#0')).toBe(false);
  });

  it('masque la plage de tête sans jamais toucher au préambule', () => {
    applyVisibility(play, visibility([], [LEAD_RANGE_ID]), NO_LINES);
    expect(hidden('lead#0')).toBe(true);
    expect(preambleTouched()).toBe(false);
    expect(hidden('a1#0')).toBe(false);
  });

  it('ne touche jamais au préambule, même en masquant tout', () => {
    applyVisibility(play, visibility(['h-1', 'h-4', 'h-6'], [LEAD_RANGE_ID, 'h-1', 'h-4', 'h-6']), NO_LINES);
    expect(preambleTouched()).toBe(false);
    expect(hidden('m1#0')).toBe(true);
  });

  it('retire tout au décochage (visibilité vide)', () => {
    applyVisibility(play, visibility(['h-1', 'h-4'], [LEAD_RANGE_ID, 'h-1', 'h-4']), NO_LINES);
    applyVisibility(play, visibility([], []), NO_LINES);
    expect(play.querySelectorAll('.scene--hidden')).toHaveLength(0);
  });

  it('ignore un id absent du DOM (en-tête d\'acte supprimé en mode showAct)', () => {
    applyVisibility(play, visibility(['h-99'], ['h-99']), NO_LINES);
    expect(play.querySelectorAll('.scene--hidden')).toHaveLength(0);
  });
});

/**
 * Même parcours que le masquage, exposé au moteur audio pour la boucle : lui ne voit
 * qu'une liste plate de tirades et n'a aucun autre moyen de savoir où finit une scène.
 * Le vérifier séparément est ce qui empêche les deux usages de diverger.
 */
describe('rangeIndex', () => {
  it('rattache chaque nœud à sa plage, l\'en-tête compris', () => {
    expect(Object.fromEntries(rangeIndex(play))).toEqual({
      'lead#0': LEAD_RANGE_ID, // avant tout en-tête
      'a1#0': 'h-1', // l'en-tête d'acte ouvre sa propre plage
      'p1#0': 'h-1', // prologue de l'acte : il en hérite
      'p2#0': 'h-1',
      's1#0': 'h-4',
      'b1#0': 'h-4',
      's2#0': 'h-6',
      'm1#0': 'h-6',
    });
  });

  it('n\'indexe pas le préambule (il n\'appartient à aucune plage)', () => {
    const nids = [...rangeIndex(play).keys()];
    expect(nids).toHaveLength(play.querySelectorAll('[data-nid]').length);
    expect(nids.some((n) => n.includes('header'))).toBe(false);
  });

  /* Une scène masquée reste dans l'index : la remettre en visibilité ne doit pas lui
     faire perdre sa plage, sinon la boucle cesserait de la reconnaître. */
  it('garde les plages masquées', () => {
    applyVisibility(play, visibility(['h-6'], ['h-6']), NO_LINES);
    expect(rangeIndex(play).get('m1#0')).toBe('h-6');
  });
});

/**
 * Pièce minimale avec didascalies : benji est « moi ». Chaque cas du filtre de
 * répliques se lit sur ce découpage (o = autre personnage, st = didascalie).
 */
const LINES_BODY =
  '<article class="play">' +
  '<header class="play-header"><h1 class="title">Pièce</h1></header>' +
  '<h3 class="scene" id="h-1" data-nid="s1#0">SCENE I.</h3>' +
  '<p class="line" data-cid="gerald" data-nid="o1#0">Cue.</p>' +
  '<p class="stage" data-nid="st1#0">Il entre.</p>' +
  '<p class="line" data-cid="benji" data-nid="b1#0">Ma réplique.</p>' +
  '<p class="stage" data-nid="st2#0">Il sort.</p>' +
  '<p class="line" data-cid="gerald" data-nid="o2#0">Bavardage.</p>' +
  '<p class="stage" data-nid="st3#0">Un silence.</p>' +
  '<p class="line" data-cid="michel" data-nid="o3#0">Seconde cue.</p>' +
  '<p class="line" data-cid="benji" data-nid="b2#0">Deux de suite.</p>' +
  '<p class="line" data-cid="benji" data-nid="b3#0">Encore moi.</p>' +
  '<p class="line" data-cid="gerald" data-nid="o4#0">Fin de scène.</p>' +
  '<h3 class="scene" id="h-2" data-nid="s2#0">SCENE II.</h3>' +
  '<p class="line" data-cid="benji" data-nid="b4#0">Après le titre.</p>' +
  '<p class="stage" data-nid="st4#0">Noir.</p>' +
  '</article>';

describe('lineFilterHidden', () => {
  beforeEach(() => {
    document.body.innerHTML = LINES_BODY;
    play = document.querySelector<HTMLElement>('.play')!;
  });

  const ME = ['benji'];

  it('mine : les titres et mes répliques restent, les autres répliques tombent', () => {
    const out = lineFilterHidden(play, 'mine', ME);
    for (const nid of ['s1#0', 's2#0', 'b1#0', 'b2#0', 'b3#0', 'b4#0']) expect(out.has(nid)).toBe(false);
    for (const nid of ['o1#0', 'o2#0', 'o3#0', 'o4#0']) expect(out.has(nid)).toBe(true);
  });

  it('garde la didascalie juste avant ma réplique, masque les autres', () => {
    const out = lineFilterHidden(play, 'mine', ME);
    expect(out.has('st1#0')).toBe(false); // juste avant b1
    expect(out.has('st2#0')).toBe(true); // après ma réplique, devant celle d'un autre
    expect(out.has('st3#0')).toBe(true); // entre deux répliques d'autres
    expect(out.has('st4#0')).toBe(true); // didascalie finale en attente
  });

  it('mineWithCue : garde la réplique qui précède la mienne, même à travers une didascalie', () => {
    const out = lineFilterHidden(play, 'mineWithCue', ME);
    expect(out.has('o1#0')).toBe(false); // st1 s'intercale entre la cue et b1
    expect(out.has('st1#0')).toBe(false);
    expect(out.has('o3#0')).toBe(false); // cue de b2
    expect(out.has('o2#0')).toBe(true); // ne précède aucune réplique à moi
    expect(out.has('o4#0')).toBe(true);
    expect(out.has('st2#0')).toBe(true);
    expect(out.has('st3#0')).toBe(true);
  });

  it('pas de cue à travers un titre', () => {
    const out = lineFilterHidden(play, 'mineWithCue', ME);
    expect(out.has('o4#0')).toBe(true); // dernière réplique de la scène I, b4 ouvre la scène II
    expect(out.has('s2#0')).toBe(false);
  });

  it('deux répliques à moi de suite : rien de plus n\'est gardé', () => {
    const out = lineFilterHidden(play, 'mineWithCue', ME);
    expect(out.has('b2#0')).toBe(false);
    expect(out.has('b3#0')).toBe(false);
    expect(out.has('o2#0')).toBe(true); // seule la réplique avant la première est une cue
  });

  it('all ou aucun rôle : rien n\'est filtré', () => {
    expect(lineFilterHidden(play, 'all', ME).size).toBe(0);
    expect(lineFilterHidden(play, 'mine', []).size).toBe(0);
    expect(lineFilterHidden(play, 'mineWithCue', []).size).toBe(0);
  });

  it('ne touche jamais au préambule', () => {
    applyVisibility(play, visibility([], []), lineFilterHidden(play, 'mine', ME));
    expect(play.querySelector('header.play-header')!.classList.contains('scene--hidden')).toBe(false);
  });

  it('applyVisibility fait l\'union avec le verdict de scène, et « all » ne lève que le filtre', () => {
    applyVisibility(play, visibility(['h-2'], ['h-2']), lineFilterHidden(play, 'mine', ME));
    expect(hidden('o1#0')).toBe(true); // filtre de répliques
    expect(hidden('b4#0')).toBe(true); // verdict de scène (h-2 masqué)
    expect(hidden('s2#0')).toBe(true);
    expect(hidden('b1#0')).toBe(false);
    applyVisibility(play, visibility(['h-2'], ['h-2']), NO_LINES);
    expect(hidden('o1#0')).toBe(false);
    expect(hidden('st3#0')).toBe(false);
    expect(hidden('b4#0')).toBe(true); // la scène reste masquée
  });
});
