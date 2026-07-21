// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { createSearch, MIN_QUERY_LENGTH } from './search';

describe('@theatre/reader-ui — recherche', () => {
  let root: HTMLElement;

  beforeEach(() => {
    // happy-dom n'implémente pas scrollIntoView.
    Element.prototype.scrollIntoView = () => {};
    document.body.innerHTML =
      '<div id="play">' +
      '<p class="line"><span class="cue">GERALD</span><span class="speech">Vous n’avez pas compris.</span></p>' +
      '<p class="line"><span class="cue">BREVIER</span><span class="speech">Non Mr. le Directeur.</span></p>' +
      '<p class="line"><span class="speech">Le directeur a compris, le Directeur.</span></p>' +
      '</div>';
    root = document.getElementById('play')!;
  });

  const marks = () => root.querySelectorAll('mark.reader-hit');

  it('surligne toutes les occurrences, insensible à la casse', () => {
    const search = createSearch(root);
    expect(search.run('directeur')).toBe(3);
    expect(marks()).toHaveLength(3);
  });

  it("préserve la casse d'origine du texte surligné", () => {
    const search = createSearch(root);
    search.run('directeur');
    expect([...marks()].map((m) => m.textContent)).toEqual([
      'Directeur',
      'directeur',
      'Directeur',
    ]);
  });

  it('ignore les requêtes trop courtes', () => {
    const search = createSearch(root);
    expect(search.run('d'.repeat(MIN_QUERY_LENGTH - 1))).toBe(0);
    expect(marks()).toHaveLength(0);
  });

  it('parcourt les résultats de façon cyclique dans les deux sens', () => {
    const search = createSearch(root);
    search.run('directeur');
    expect(search.index).toBe(0);
    expect(search.step(1)).toBe(1);
    expect(search.step(1)).toBe(2);
    expect(search.step(1)).toBe(0);
    expect(search.step(-1)).toBe(2);
  });

  it('ne marque comme courant qu’un seul résultat à la fois', () => {
    const search = createSearch(root);
    search.run('directeur');
    search.step(1);
    const current = root.querySelectorAll('mark.reader-hit--current');
    expect(current).toHaveLength(1);
    expect(current[0]).toBe(marks()[1]);
  });

  it('restaure le texte exact et refusionne les nœuds à la remise à zéro', () => {
    const before = root.innerHTML;
    const search = createSearch(root);
    search.run('compris');
    expect(marks().length).toBeGreaterThan(0);
    search.clear();
    expect(marks()).toHaveLength(0);
    expect(root.innerHTML).toBe(before);
    // Refusion effective : le texte ne doit pas rester éclaté en trois nœuds,
    // sinon une recherche ultérieure ne retrouverait plus les occurrences à
    // cheval sur les anciennes coupures.
    const speech = root.querySelector('.speech')!;
    expect(speech.childNodes).toHaveLength(1);
  });

  it('nettoie la recherche précédente avant la suivante', () => {
    const search = createSearch(root);
    search.run('directeur');
    expect(search.run('compris')).toBe(2);
    expect(marks()).toHaveLength(2);
  });

  it('ignore le texte des scènes masquées (option « mes scènes »)', () => {
    // Une scène masquée porte .scene--hidden : son texte ne doit pas être compté
    // ni cadré, sinon la recherche saute « dans le vide » (occurrence invisible).
    root.innerHTML =
      '<h3 class="scene"><span>SCENE I</span></h3>' +
      '<p class="line"><span class="speech">Le directeur parle.</span></p>' +
      '<div class="scene--hidden">' +
      '<h3 class="scene"><span>SCENE II</span></h3>' +
      '<p class="line"><span class="speech">Le directeur caché.</span></p>' +
      '</div>';
    const search = createSearch(root);
    expect(search.run('directeur')).toBe(1); // seule l'occurrence visible compte
  });

  it('retombe sur ses pieds si le conteneur a été vidé entre-temps', () => {
    const search = createSearch(root);
    search.run('directeur');
    // Cas réel : le lecteur web re-pagine et remplace tout le DOM sous les
    // marques déjà posées.
    root.innerHTML = '<p class="line"><span class="speech">Autre chose.</span></p>';
    expect(() => search.clear()).not.toThrow();
    expect(search.count).toBe(0);
  });
});
