import { describe, expect, it } from 'vitest';
import { evaluate, evaluatePrefix, tokenize } from './evaluate';
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

  it('tolère le « n\' » élidé devant voyelle, dans les deux sens', () => {
    expect(verdict("On n'a rien fait.", 'on a rien fait')).toBe('ok');
    expect(verdict('On a rien fait.', "on n'a rien fait")).toBe('ok');
  });

  it("assimile « environ » et « en virant », dans les deux sens", () => {
    expect(verdict('Il reste environ deux minutes.', 'il reste en virant deux minutes')).toBe('ok');
    expect(verdict('Il reste en virant deux minutes.', 'il reste environ deux minutes')).toBe('ok');
  });

  it("assimile « plutôt » et « plus tôt », dans les deux sens et en strict", () => {
    expect(verdict('Il vient plutôt demain.', 'il vient plus tôt demain')).toBe('ok');
    expect(verdict('Il vient plus tôt demain.', 'il vient plutôt demain')).toBe('ok');
    expect(verdict('Il vient plutôt demain.', 'il vient plus tôt demain', 'strict')).toBe('ok');
    expect(verdict('Il vient plus tôt demain.', 'il vient plutôt demain', 'strict')).toBe('ok');
  });

  it("assimile « tant » et « tente », dans les deux sens et en strict", () => {
    expect(verdict('Il a tant et si bien insisté.', 'il a tente et si bien insisté')).toBe('ok');
    expect(verdict('Il a tente et si bien insisté.', 'il a tant et si bien insisté')).toBe('ok');
    expect(verdict('Il a tant et si bien insisté.', 'il a tente et si bien insisté', 'strict')).toBe('ok');
    expect(verdict('Il a tente et si bien insisté.', 'il a tant et si bien insisté', 'strict')).toBe('ok');
  });

  it("assimile « on » et « en », dans les deux sens et en strict", () => {
    expect(verdict('On part demain matin.', 'en part demain matin')).toBe('ok');
    expect(verdict('Il en reste deux.', 'il on reste deux')).toBe('ok');
    expect(verdict('On part demain matin.', 'en part demain matin', 'strict')).toBe('ok');
  });

  it('assimile les civilités abrégées et leur mot entier, dans les deux sens et en strict', () => {
    for (const mode of ['soft', 'strict'] as const) {
      const pairs: [string, string][] = [['Mr', 'monsieur'], ['M.', 'monsieur'], ['Mme', 'madame'], ['Mlle', 'mademoiselle']];
      for (const [short, full] of pairs) {
        expect(verdict(`Bonjour ${short} Dupont.`, `bonjour ${full} Dupont`, mode)).toBe('ok');
        expect(verdict(`Bonjour ${full} Dupont.`, `bonjour ${short.toLowerCase().replace('.', '')} Dupont`, mode)).toBe('ok');
      }
    }
    expect(verdict('Bonjour madame Dupont.', 'bonjour mademoiselle Dupont')).not.toBe('ok');
  });

  it('traite « ça » et « sa » comme le même son, cédille comprise', () => {
    for (const mode of ['soft', 'strict'] as const) {
      expect(verdict('Ça va ?', 'sa va', mode)).toBe('ok');
      expect(verdict('Sa mère vient.', 'ça mère vient', mode)).toBe('ok');
      expect(verdict('Le garçon part.', 'le garson part', mode)).toBe('ok');
    }
  });

  it('assimile les contractions « t’as », « t’es », « j’suis » et leur forme pleine', () => {
    const pairs: [string, string][] = [
      ['T’as vu ça ?', 'tu as vu ça'],
      ['Tu as vu ça ?', 't’as vu ça'],
      ['T’es là ?', 'tu es là'],
      ['Tu es là ?', 't’es là'],
      ['J’suis là.', 'je suis là'],
      ['Je suis là.', 'j’suis là'],
      ['Chuis là.', 'je suis là'],
      ['Je suis là.', 'chuis là'],
    ];
    for (const mode of ['soft', 'strict'] as const) {
      for (const [expected, heard] of pairs) expect(verdict(expected, heard, mode), `${expected} | ${heard}`).toBe('ok');
    }
  });

  it('laisse tomber « il » devant « faut », comme devant « y a »', () => {
    expect(verdict('Il faut partir demain.', 'faut partir demain')).toBe('ok');
    expect(verdict('Faut partir demain.', 'il faut partir demain', 'strict')).toBe('ok');
  });

  it('assimile « ouais »/« oui » et « ben »/« bah » en souple seulement', () => {
    expect(verdict('Ouais, bien sûr.', 'oui bien sûr')).toBe('ok');
    expect(verdict('Oui, bien sûr.', 'ouais bien sûr')).toBe('ok');
    expect(verdict('Ben oui, bien sûr.', 'bah oui bien sûr')).toBe('ok');
    expect(verdict('Ouais, bien sûr.', 'oui bien sûr', 'strict')).not.toBe('ok');
    expect(verdict('Ben oui, bien sûr.', 'bah oui bien sûr', 'strict')).not.toBe('ok');
  });

  it('rapproche un mot coupé ou collé dont la nasale est confondue (« envoie » / « on voit »)', () => {
    for (const mode of ['soft', 'strict'] as const) {
      expect(verdict('Envoie ça demain.', 'on voit ça demain', mode)).toBe('ok');
      expect(verdict('On voit ça demain.', 'envoie ça demain', mode)).toBe('ok');
      expect(verdict('Il envoie ça.', 'il on voit ça', mode)).toBe('ok');
    }
  });

  it('ne confond pas la nasale hors d’un regroupement', () => {
    expect(verdict('Il a une dent cassée.', 'il a une dont cassée')).not.toBe('ok');
    expect(verdict('Ils vont partir.', 'ils vendent partir')).not.toBe('ok');
  });

  it('tolère un « ne » manquant en souple, pas en strict', () => {
    expect(verdict('Je ne sais pas.', 'je sais pas')).toBe('ok');
    expect(verdict('Je ne sais pas.', 'je sais pas', 'strict')).not.toBe('ok');
    expect(verdict('Je ne sais pas.', 'je ne sais')).toBe('fail');
  });

  it("traite « il y a », « y a », « ya » et « il ya » comme une seule chose", () => {
    const forms = ['il y a', 'y a', 'ya', 'il ya'];
    for (const expected of forms) {
      for (const heard of forms) {
        expect(verdict(`${expected} du monde ici.`, `${heard} du monde ici`)).toBe('ok');
        expect(verdict(`${expected} du monde ici.`, `${heard} du monde ici`, 'strict')).toBe('ok');
      }
    }
  });

  it("ne laisse tomber « il » que devant « y a »", () => {
    expect(verdict('Il part demain matin.', 'part demain matin')).not.toBe('ok');
  });

  it('ignore un mot répété dit une seule fois', () => {
    expect(verdict('C’est très très bien.', 'c’est très bien')).toBe('ok');
    expect(verdict('C’est très très bien.', 'c’est très bien', 'strict')).toBe('ok');
    expect(verdict('Non non non, jamais.', 'non jamais')).toBe('ok');
  });

  it('ignore un mot dit deux fois quand un seul est attendu', () => {
    expect(verdict('C’est très bien.', 'c’est très très bien')).toBe('ok');
    expect(verdict('C’est très bien.', 'c’est très très bien', 'strict')).toBe('ok');
  });

  it("ne pardonne pas un mot répété absent des deux côtés", () => {
    expect(verdict('Non non, jamais.', 'jamais')).toBe('fail');
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

describe('homophones', () => {
  // Le cas qui a motivé la comparaison phonétique : la reconnaissance écrit
  // « haut » là où la pièce écrit « o », et la réplique porte sur ce mot-là.
  it('valide une réplique dont la dictée a choisi une autre graphie', () => {
    const attendu = 'Je suis désolé de te le dire mais dans « chevelure » y’a pas de « o ».';
    const r = evaluate(attendu, "je suis désolé de te le dire mais dans chevelure y'a pas de haut");
    expect(r.verdict).toBe('ok');
    expect(r.score).toBe(1);
    expect(r.words.every((w) => w.status === 'ok')).toBe(true);
  });

  it('accepte les confusions classiques de la dictée, même en strict', () => {
    expect(verdict('Il est là.', 'il et la', 'strict')).toBe('ok');
    expect(verdict('Regarde ce verre.', 'regarde ce vert', 'strict')).toBe('ok');
    expect(verdict("C'est à toi.", 'ces a toi', 'strict')).toBe('ok');
  });

  // Ceux-là ne sont PAS homophones : la dictée tranche entre eux d'après le nom
  // qui suit. C'est une exception lexicale assumée, pas une règle de son.
  it('accepte les démonstratifs interchangés', () => {
    expect(verdict('Ouvre cette porte.', 'ouvre ces porte')).toBe('ok');
    expect(verdict('Range ces papiers.', 'range cette papiers')).toBe('ok');
    expect(verdict('Ouvre cette porte.', 'ouvre ces porte', 'strict')).toBe('ok');
  });

  it('rapproche le pluriel verbal en « -ent » de son singulier, en strict aussi', () => {
    for (const mode of ['soft', 'strict'] as const) {
      expect(verdict('Ils dégagent de là.', 'ils dégage de là', mode)).toBe('ok');
      expect(verdict('Il dégage de là.', 'il dégagent de là', mode)).toBe('ok');
      expect(verdict('Elles chantent bien.', 'elles chante bien', mode)).toBe('ok');
    }
  });

  it("ne prend pas pour un pluriel un mot qui finit en « -ent »", () => {
    expect(verdict('Il sent la rose.', 'il se la rose')).not.toBe('ok');
    expect(verdict('Comment va-t-il ?', 'comme va t il')).not.toBe('ok');
  });

  it("n'étend pas l'exception aux mots qui portent le sens", () => {
    expect(verdict('Ouvre cette porte.', 'ouvre cette fenêtre')).not.toBe('ok');
  });

  it('ne rapproche pas deux mots qui sonnent différemment', () => {
    expect(verdict('Le ciel est bon.', 'le ciel est beau')).not.toBe('ok');
    expect(verdict('Il descend la rue.', 'il descend la roue')).not.toBe('ok');
  });

  // Arbitrage assumé des deux modes : une lettre d'écart reste absorbée en souple
  // (c'est le filet contre une transcription approximative), et refusée en strict.
  it('laisse au mode strict les paires à une lettre près', () => {
    expect(verdict('Passe-moi le poisson.', 'passe moi le poison')).toBe('ok');
    expect(verdict('Passe-moi le poisson.', 'passe moi le poison', 'strict')).toBe('fail');
  });
});

// La dictée décide seule de la segmentation : elle coupe les mots qu'elle ne
// connaît pas — et une pièce en est pleine — et colle ceux qu'elle croit liés.
describe('découpage des mots par la dictée', () => {
  it('accepte un mot inventé coupé en deux', () => {
    const r = evaluate('La chévéloure non ! Alors arrête de tricher.', 'La Chévé lourd non alors arrête de tricher');
    expect(r.verdict).toBe('ok');
    expect(r.score).toBe(1);
    expect(r.added).toEqual([]);
  });

  it("accepte l'élision rendue en deux mots", () => {
    expect(verdict("Y'a pas de o.", 'y a pas de o')).toBe('ok');
    expect(verdict("Y'a pas de o.", 'y a pas de o', 'strict')).toBe('ok');
  });

  it('accepte deux mots rendus collés', () => {
    expect(verdict('Il part tout de suite.', 'il part tout desuite')).toBe('ok');
  });

  it('ne colle pas des voisins pour absorber un mot en trop', () => {
    const r = evaluate('Je pars demain.', 'je pars euh demain', { tolerance: 'strict' });
    expect(r.words.find((w) => w.text === 'demain')?.status).toBe('ok');
    expect(r.added.map((a) => a.text)).toEqual(['euh']);
  });

  it('ne regroupe pas deux mots qui ne sonnent pas comme celui attendu', () => {
    const r = evaluate('Le portail était ouvert.', 'le chien noir était ouvert');
    expect(r.verdict).toBe('fail');
    expect(r.words.find((w) => w.text === 'portail')?.status).not.toBe('ok');
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

describe('evaluatePrefix', () => {
  const TEXT = 'Je ne reviendrai jamais dans cette maison.';

  it('juge propre le début d’une longue tirade encore en cours', () => {
    const r = evaluatePrefix(TEXT, 'je ne reviendrai');
    expect(r.total).toBe(7);
    expect(r.reached).toBe(3);
    expect(r.verdict).not.toBe('fail');
  });

  it('échoue quand un passage entier a été sauté avant de reprendre plus loin', () => {
    const expected = 'Je pars demain matin sans dire au revoir à personne.';
    const r = evaluatePrefix(expected, 'je pars a personne');
    expect(r.verdict).toBe('fail');
  });

  it('échoue sur une négation absente à l’intérieur du passage couvert', () => {
    const r = evaluatePrefix(TEXT, 'je ne reviendrai dans cette');
    expect(r.reached).toBeGreaterThanOrEqual(5);
    expect(r.verdict).toBe('fail');
  });

  // Le piège de la ligne 0 : si `i = 0` pouvait servir de fin libre, ces trois mots
  // (dont l'un est mal transcrit) seraient avalés comme amorce gratuite, avec zéro
  // mot atteint. Ce test échoue net si la garde `i ∈ [1, n]` d'align.ts disparaît.
  it('n’avale jamais le début comme une amorce gratuite (piège ligne 0)', () => {
    const r = evaluatePrefix('Je reviendrai jamais dans cette maison.', 'je revien jamais');
    expect(r.reached).toBeGreaterThanOrEqual(3);
  });

  it('reconnaît une autocorrection en cours, pas encore terminée', () => {
    const r = evaluatePrefix(TEXT, 'je reviendrai non je ne reviendrai');
    expect(r.reached).toBeGreaterThan(0);
    expect(r.verdict).not.toBe('fail');
  });

  it("ne prend pas un ordre vocal isolé pour un début de tirade", () => {
    expect(evaluatePrefix(TEXT, 'passe').verdict).toBe('fail');
  });

  it('échoue sur une réplique totalement étrangère', () => {
    expect(evaluatePrefix(TEXT, 'bonsoir madame comment allez vous').verdict).toBe('fail');
  });

  // Ancrage de non-régression : sur une lecture complète et correcte, la fin libre
  // atteint toute la tirade et s'accorde avec `evaluate` — jamais un verdict qui le
  // contredit à l'oreille (ok/borderline d'un côté, fail de l'autre).
  it('s’accorde avec `evaluate` quand la tirade est dite en entier', () => {
    const cases: [string, string][] = [
      [TEXT, 'je ne reviendrai jamais dans cette maison'],
      ["Je ne sais pas ce qu'il veut.", "je sais pas ce qu'il veut"],
      ['Il reviendrait demain matin.', 'il reviendrais demain matin'],
    ];
    for (const [expected, heard] of cases) {
      const full = evaluate(expected, heard);
      const prefix = evaluatePrefix(expected, heard);
      expect(prefix.reached).toBe(prefix.total);
      expect(prefix.verdict === 'fail').toBe(full.verdict === 'fail');
    }
  });
});

describe('robustesse', () => {
  it('ne casse pas sur un texte attendu vide', () => {
    expect(evaluate('', 'bonjour').verdict).toBe('ok');
  });

  it('canonicalise une liste de jetons déjà découpée', () => {
    expect(canonicalizeNumbers(splitWords('trente-deux')).map((t) => t.raw)).toEqual(['trente deux']);
  });

  it("ne plante pas quand un seul mot attendu se découpe en trois côté dictée", () => {
    expect(() => evaluate('Chevelure.', 'ché vé lourd')).not.toThrow();
  });
});
