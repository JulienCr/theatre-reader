import { describe, expect, it } from 'vitest';
import { evaluate, tokenize } from './evaluate';
import { canonicalizeNumbers } from './numbers';
import { splitWords } from './normalize';

const keys = (text: string): string[] => tokenize(text).map((t) => t.key);
const verdict = (expected: string, heard: string, tolerance?: 'strict' | 'soft'): string =>
  evaluate(expected, heard, tolerance ? { tolerance } : {}).verdict;

describe('normalisation', () => {
  it('déplie les accents, la casse et la ponctuation', () => {
    expect(keys('Élève, où es-tu ?')).toEqual(['eleve', 'ou', 'es', 'tu']);
  });

  it("uniformise l'apostrophe typographique", () => {
    expect(keys('j’ai')).toEqual(keys("j'ai"));
  });

  it('repère les noms propres, mais pas les majuscules de début de phrase', () => {
    const t = splitWords('Parle. Demande à Michel.');
    expect(t.map((x) => [x.raw, x.proper])).toEqual([
      ['Parle', false], // ouvre le texte
      ['Demande', false], // ouvre une phrase
      ['à', false],
      ['Michel', true],
    ]);
  });
});

describe('nombres', () => {
  it('rend équivalents chiffres, trait d’union et espace', () => {
    expect(keys('22')).toEqual(['#22']);
    expect(keys('vingt-deux')).toEqual(['#22']);
    expect(keys('vingt deux')).toEqual(['#22']);
  });

  it('gère les composés français', () => {
    expect(keys('quatre-vingt-dix-sept')).toEqual(['#97']);
    expect(keys('soixante-quinze')).toEqual(['#75']);
    expect(keys('vingt et un')).toEqual(['#21']);
    expect(keys('deux cent trois')).toEqual(['#203']);
    expect(keys('mille deux cents')).toEqual(['#1200']);
  });

  it("laisse « un » article tranquille", () => {
    expect(keys('un chien')).toEqual(['un', 'chien']);
    expect(keys('une fois')).toEqual(['une', 'fois']);
  });

  it("n'avale pas le « et » d'une énumération", () => {
    expect(keys('deux et trois')).toEqual(['#2', 'et', '#3']);
  });

  it('valide une réplique dont le nombre est dit en lettres', () => {
    expect(verdict('Il en reste 22.', 'il en reste vingt-deux')).toBe('ok');
  });

  it('refuse un nombre changé', () => {
    expect(verdict('Il en reste 22.', 'il en reste vingt-trois')).toBe('fail');
  });
});

describe('verdicts', () => {
  it('valide une réplique exacte', () => {
    const r = evaluate('Je ne reviendrai jamais dans cette maison.', 'je ne reviendrai jamais dans cette maison');
    expect(r.verdict).toBe('ok');
    expect(r.score).toBe(1);
    expect(r.words.every((w) => w.status === 'ok')).toBe(true);
  });

  it('distingue le silence d’une erreur', () => {
    expect(verdict('Bonjour à tous.', '')).toBe('no-speech');
    expect(verdict('Bonjour à tous.', '   ')).toBe('no-speech');
  });

  it('échoue quand la négation disparaît', () => {
    const r = evaluate('Je ne reviendrai jamais.', 'je reviendrai');
    expect(r.verdict).toBe('fail');
    expect(r.words.find((w) => w.text === 'jamais')?.status).toBe('missing');
  });

  it('tolère le « ne » avalé, que personne ne prononce', () => {
    expect(verdict("Je ne sais pas ce qu'il veut.", "je sais pas ce qu'il veut")).toBe('ok');
  });

  it('absorbe une approximation de transcription sur un mot plein', () => {
    expect(verdict('Il reviendrait demain matin.', 'il reviendrais demain matin')).toBe('ok');
  });

  it('valide de justesse une réplique brodée, et dit ce qui a été ajouté', () => {
    const r = evaluate('Je pars demain.', 'je pars demain matin');
    expect(r.verdict).toBe('borderline');
    expect(r.added.map((a) => a.text)).toEqual(['matin']);
  });

  // En tête d'énoncé une hésitation serait de toute façon avalée par le départ
  // libre : c'est au milieu qu'elle éprouve vraiment le filtre.
  it('ignore les hésitations en souple, pas en strict', () => {
    expect(verdict('Je pars demain.', 'je pars euh demain')).toBe('ok');
    expect(verdict('Je pars demain.', 'je pars euh demain', 'strict')).toBe('borderline');
  });

  it('ne valide jamais franchement un mot plein dit à la place d’un autre', () => {
    const r = evaluate('Il partait chaque matin.', 'il partait chaque soir');
    expect(r.verdict).not.toBe('ok');
    expect(r.words.find((w) => w.text === 'matin')?.heard).toBe('soir');
  });

  it('refuse une tirade dont il manque un mot plein', () => {
    expect(verdict('Je ne reviendrai jamais dans cette maison.', 'je ne reviendrai jamais dans cette')).toBe('fail');
  });

  it('signale les mots manquants et remplacés', () => {
    const r = evaluate('Le grand portail bleu était ouvert.', 'le portail vert était ouvert');
    expect(r.words.find((w) => w.text === 'grand')?.status).toBe('missing');
    const bleu = r.words.find((w) => w.text === 'bleu');
    expect(bleu?.status).toBe('replaced');
    expect(bleu?.heard).toBe('vert');
  });

  it('échoue sur une réplique étrangère', () => {
    expect(verdict('Le grand portail bleu était ouvert.', 'bonsoir madame comment allez vous')).toBe('fail');
  });
});

describe('autocorrection orale', () => {
  it('accepte une reprise immédiate', () => {
    const r = evaluate('Je ne reviendrai jamais.', 'je reviendrai non je ne reviendrai jamais');
    expect(r.verdict).toBe('ok');
    expect(r.added).toEqual([]);
  });

  it("n'accepte pas une bonne fin noyée dans un long préambule", () => {
    const long = 'je ne sais plus du tout ce que je dois dire ici et je continue de parler pour ne rien dire';
    expect(verdict('Je pars demain.', `${long} je pars demain`)).toBe('fail');
  });

  // Une reprise tardive passe, mais elle ne passe plus « proprement » : les mots de
  // l'amorce au-delà de la limite comptent comme dits en trop.
  it('reste plus sévère en strict sur la longueur de la reprise', () => {
    const expected = 'Je ne reviendrai jamais dans cette maison de campagne.';
    const heard = 'je ne reviendrai plus dans cette non je ne reviendrai jamais dans cette maison de campagne';
    expect(verdict(expected, heard)).toBe('borderline');
    expect(verdict(expected, heard, 'strict')).toBe('fail');
  });
});

describe('tolérance', () => {
  it('strict refuse le mot avalé que souple laisse passer', () => {
    const expected = 'Il partait chaque matin avant le lever du jour.';
    const heard = 'il partait chaque matin avant lever du jour';
    expect(verdict(expected, heard)).toBe('ok');
    expect(verdict(expected, heard, 'strict')).toBe('fail');
  });

  it('strict bloque sur un nom propre écorché, souple non', () => {
    const expected = 'Demande à Giuseppe.';
    const heard = 'demande a giuseppa';
    expect(verdict(expected, heard, 'strict')).toBe('fail');
    expect(verdict(expected, heard)).not.toBe('fail');
  });
});

describe('robustesse', () => {
  it('ne casse pas sur un texte attendu vide', () => {
    expect(evaluate('', 'bonjour').verdict).toBe('ok');
  });

  it('canonicalise une liste de jetons déjà découpée', () => {
    expect(canonicalizeNumbers(splitWords('trente-deux')).map((t) => t.raw)).toEqual(['trente deux']);
  });
});
