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
];

const CLASS_OF = new Map<string, number>();
CLASSES.forEach((words, i) => words.forEach((w) => CLASS_OF.set(w, i)));

/** Vrai quand les deux mots appartiennent à la même classe de variantes. */
export function sameVariant(a: string, b: string): boolean {
  const cls = CLASS_OF.get(a);
  return cls !== undefined && cls === CLASS_OF.get(b);
}
