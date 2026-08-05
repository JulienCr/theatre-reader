// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { LEAD_RANGE_ID, type SceneVisibility } from '@theatre/core';
import { applySceneVisibility } from './visibility';

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

describe('applySceneVisibility', () => {
  it('masque le prologue d\'un acte sans masquer son en-tête', () => {
    applySceneVisibility(play, visibility([], ['h-1']));
    expect(hidden('a1#0')).toBe(false); // le titre d'acte reste un repère
    expect(hidden('p1#0')).toBe(true);
    expect(hidden('p2#0')).toBe(true);
    expect(hidden('s1#0')).toBe(false); // la plage s'arrête au prochain en-tête
    expect(hidden('b1#0')).toBe(false);
  });

  it('masque en-tête et contenu quand l\'id est dans headings', () => {
    applySceneVisibility(play, visibility(['h-6'], ['h-6']));
    expect(hidden('s2#0')).toBe(true);
    expect(hidden('m1#0')).toBe(true);
    expect(hidden('b1#0')).toBe(false);
  });

  it('masque la plage de tête sans jamais toucher au préambule', () => {
    applySceneVisibility(play, visibility([], [LEAD_RANGE_ID]));
    expect(hidden('lead#0')).toBe(true);
    expect(preambleTouched()).toBe(false);
    expect(hidden('a1#0')).toBe(false);
  });

  it('ne touche jamais au préambule, même en masquant tout', () => {
    applySceneVisibility(play, visibility(['h-1', 'h-4', 'h-6'], [LEAD_RANGE_ID, 'h-1', 'h-4', 'h-6']));
    expect(preambleTouched()).toBe(false);
    expect(hidden('m1#0')).toBe(true);
  });

  it('retire tout au décochage (visibilité vide)', () => {
    applySceneVisibility(play, visibility(['h-1', 'h-4'], [LEAD_RANGE_ID, 'h-1', 'h-4']));
    applySceneVisibility(play, visibility([], []));
    expect(play.querySelectorAll('.scene--hidden')).toHaveLength(0);
  });

  it('ignore un id absent du DOM (en-tête d\'acte supprimé en mode showAct)', () => {
    applySceneVisibility(play, visibility(['h-99'], ['h-99']));
    expect(play.querySelectorAll('.scene--hidden')).toHaveLength(0);
  });
});
