/**
 * Mots qu'on accepte l'un pour l'autre, sans qu'ils sonnent pareil.
 *
 * La comparaison phonétique couvre déjà tout ce qui se prononce identiquement
 * (`ces`/`ses`/`sais`). Restent quelques mots-outils que la dictée intervertit
 * alors même qu'ils s'entendent différemment : `cette maison` rendu `ces maison`
 * en est le cas type — /sɛt/ et /se/ ne sont pas le même son, mais devant un nom
 * la reconnaissance choisit d'après sa grammaire, pas d'après ce qu'elle entend.
 *
 * Cette table est délibérément COURTE et le restera. Chaque entrée est une
 * exception assumée : elle rend deux textes différents équivalents, ce qui n'a de
 * sens que sur des mots dont l'échange ne déplace pas le sens d'une réplique.
 * Un verbe, un nom ou une négation n'y ont pas leur place — c'est justement ce que
 * la répétition doit apprendre.
 *
 * L'équivalence ne passe PAS par la clé de comparaison : elle est consultée à la
 * similarité seule (cf. `align.ts`). Réécrire la clé ferait fuiter l'exception
 * dans le poids des mots, dans la phonétique et dans les regroupements, alors
 * qu'on veut exactement une chose : que ces deux-là ne comptent pas comme un écart.
 */

/** Chaque classe regroupe des formes interchangeables à l'oreille d'un lecteur. */
const CLASSES: string[][] = [
  // Démonstratifs : la dictée tranche entre eux d'après le nom qui suit, pas
  // d'après ce qui a été dit.
  ['ce', 'cet', 'cette', 'ces'],
  // `envirant` n'est pas un mot : c'est la clé de `en` + `virant` collés par
  // `joined()` (align.ts) quand la dictée découpe « environ » en deux mots.
  // L'entrée sert donc aux deux sens — regroupement (`merge`) et découpage
  // (`split`) — sans jamais apparaître seule dans un texte.
  ['environ', 'envirant'],
  // `plustot` : clé jointe de `plus` + `tôt`. Contrairement à `environ`/`en
  // virant`, le sens peut différer (« plutôt demain » = à la place, « plus
  // tôt demain » = plus tôt) — exception assumée quand même, à l'image de
  // `ce`/`cette` : la confusion de dictée est trop fréquente pour la laisser
  // échouer en `strict`.
  ['plutot', 'plustot'],
  // `tant` (t final muet) et `tente` (t dégagé par la chute du e muet) ne
  // sonnent pas pareil au sens strict du moteur phonétique, mais la dictée
  // les confond dans « tant et si bien » / « tente et si bien » — exception
  // assumée sur confirmation, comme les deux précédentes.
  ['tant', 'tente'],
  // `on` / `en` : l'iPhone les confond sans cesse, exception assumée à la demande de l'acteur.
  ['on', 'en'],
  // Abréviations de civilité : la pièce écrit `M.`/`Mme`, l'acteur dit le mot entier.
  ['monsieur', 'mr', 'm'],
  ['madame', 'mme'],
  ['mademoiselle', 'mlle'],
  // Contractions orales rendues en un ou deux mots. Clés JOINTES (`tuas` = `tu` + `as`,
  // cf. `joined()` dans align.ts) : `t'as`/`tu as` ne sonnent pas pareil pour `phonetic.ts`.
  ["t'as", 'tuas'],
  ["t'es", 'tues'],
  ["j'suis", 'jesuis', 'chuis', 'chui'],
];

/**
 * Classes réservées au mode souple : des mots du texte que l'acteur peut remplacer
 * par un équivalent de registre (`ouais` dit `oui`). Les accepter en strict serait
 * trahir le texte, d'où une table à part.
 */
const SOFT_CLASSES: string[][] = [
  ['ouais', 'oui'],
  ['ben', 'bah'],
];

function indexClasses(classes: string[][]): Map<string, number> {
  const index = new Map<string, number>();
  classes.forEach((words, i) => words.forEach((w) => index.set(w, i)));
  return index;
}

const CLASS_OF = indexClasses(CLASSES);
const SOFT_CLASS_OF = indexClasses(SOFT_CLASSES);

function sameIn(index: Map<string, number>, a: string, b: string): boolean {
  const cls = index.get(a);
  return cls !== undefined && cls === index.get(b);
}

/** Vrai quand les deux mots appartiennent à la même classe de variantes (`soft` ajoute les classes souples). */
export function sameVariant(a: string, b: string, soft = false): boolean {
  return sameIn(CLASS_OF, a, b) || (soft && sameIn(SOFT_CLASS_OF, a, b));
}
