import { describe, expect, it } from 'vitest';
import { matchCommand } from './commands';

/** Une tirade quelconque, sans aucun mot de commande : pas de collision possible. */
const NEUTRE = 'Je ne reviendrai jamais dans cette maison.';

describe('commandes vocales', () => {
  it('reconnaît chaque formulation', () => {
    for (const s of ['passe', 'passer', 'on passe', 'suivant'])
      expect(matchCommand(s, NEUTRE)).toBe('skip');
    for (const s of ['indice', 'aide', 'aide-moi']) expect(matchCommand(s, NEUTRE)).toBe('hint');
    for (const s of ['début de la scène', 'reprends la scène', 'on reprend'])
      expect(matchCommand(s, NEUTRE)).toBe('scene-start');
    for (const s of ['scène suivante', 'prochaine scène'])
      expect(matchCommand(s, NEUTRE)).toBe('scene-next');
  });

  it("se moque des accents, de la ponctuation et de la casse — c'est de la dictée", () => {
    expect(matchCommand('Passe !', NEUTRE)).toBe('skip');
    expect(matchCommand('debut de la scene', NEUTRE)).toBe('scene-start');
    expect(matchCommand('Scène suivante.', NEUTRE)).toBe('scene-next');
    // Le pluriel que la dictée ajoute d'elle-même : même clé phonétique.
    expect(matchCommand('indices', NEUTRE)).toBe('hint');
    // « passe » et « passé » sonnent pareil — et veulent dire la même chose ici.
    expect(matchCommand('passé', NEUTRE)).toBe('skip');
  });

  it('ignore les hésitations, comme le fait l’évaluation', () => {
    expect(matchCommand('euh passe', NEUTRE)).toBe('skip');
    expect(matchCommand('hum, indice', NEUTRE)).toBe('hint');
  });

  /* La règle qui protège le texte : un ordre est l'énoncé ENTIER, pas un mot dedans. */
  it('refuse dès qu’il y a autre chose autour', () => {
    expect(matchCommand('passe la porte', NEUTRE)).toBeNull();
    expect(matchCommand('je passe par là, et je te croise', NEUTRE)).toBeNull();
    expect(matchCommand('un indice', NEUTRE)).toBeNull();
    expect(matchCommand('scène suivante peut-être', NEUTRE)).toBeNull();
    expect(matchCommand('', NEUTRE)).toBeNull();
  });

  it('n’invente pas de commande', () => {
    expect(matchCommand('bonjour', NEUTRE)).toBeNull();
    expect(matchCommand('scène', NEUTRE)).toBeNull();
  });

  /* La collision : quand la tirade contient l'ordre, c'est la pièce qui gagne. */
  describe('collision avec la tirade attendue', () => {
    it('désactive la formulation que la tirade contient', () => {
      expect(matchCommand('passe', 'Je passe par là, et je te croise.')).toBeNull();
      expect(matchCommand('passe', 'Passe.')).toBeNull();
      expect(matchCommand('indice', 'Donne-moi un indice, au moins.')).toBeNull();
      // Sur toute la suite de mots, pas seulement sur le premier.
      expect(matchCommand('scène suivante', 'On verra ça à la scène suivante.')).toBeNull();
    });

    it('laisse les autres formulations de la même commande', () => {
      expect(matchCommand('suivant', 'Je passe par là, et je te croise.')).toBe('skip');
      expect(matchCommand('on passe', 'Il passera bien un jour.')).toBe('skip');
    });

    it('ne désactive que la suite complète, pas un mot isolé', () => {
      // « suivante » seul ne fait pas « scène suivante » : l'ordre reste utilisable.
      expect(matchCommand('scène suivante', "L'année suivante, il revint.")).toBe('scene-next');
    });
  });
});
