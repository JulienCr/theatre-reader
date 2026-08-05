/**
 * Ce que coûte un mot manqué.
 *
 * Compter les mots à égalité mettrait « le » et « jamais » sur le même plan, alors
 * qu'oublier le second retourne la réplique. Trois paliers suffisent, et l'issue les
 * nomme : les mots qui changent le sens, les mots pleins, le reste.
 */
import type { Token } from './normalize';

/** Poids d'un mot qui porte le sens : sa perte fait échouer la tentative. */
export const CRITICAL = 3;

/**
 * Négations et quantificateurs : leur disparition inverse la phrase.
 *
 * `ne` en est volontairement ABSENT. Il s'élide, s'avale à l'oral (« je sais pas »)
 * et la reconnaissance le rend une fois sur deux : le traiter comme critique ferait
 * échouer des répliques correctement jouées. Le sens tient au second terme — `pas`,
 * `jamais`, `rien` —, et c'est lui qu'on garde sous surveillance.
 */
const SENSE = new Set([
  'pas',
  'plus',
  'jamais',
  'rien',
  'aucun',
  'aucune',
  'personne',
  'nul',
  'nulle',
  'sans',
  'ni',
  'non',
  'toujours',
  'point',
]);

/** Longueur à partir de laquelle un mot est « plein » plutôt qu'outil. */
const CONTENT_LENGTH = 5;

/**
 * Vrai quand perdre ce mot doit faire échouer la tentative, quel que soit le score.
 *
 * Les nombres et les négations bloquent toujours : la réplique dit alors autre chose.
 * Les noms propres ne bloquent qu'en `strict` — la reconnaissance écorche volontiers
 * un nom de personnage inhabituel, et refuser une tirade par ailleurs juste pour un
 * « Giuseppe » transcrit de travers punirait la machine à la place de l'acteur.
 */
export function blocks(t: Token, strict: boolean): boolean {
  if (t.key.startsWith('#') || SENSE.has(t.key)) return true;
  return strict && t.proper;
}

export function weightOf(t: Token): number {
  if (t.key.startsWith('#')) return CRITICAL; // un nombre, jamais approximable
  if (SENSE.has(t.key)) return CRITICAL;
  if (t.proper) return CRITICAL; // nom propre : se tromper de personnage s'entend
  return t.key.length >= CONTENT_LENGTH ? 2 : 1;
}
