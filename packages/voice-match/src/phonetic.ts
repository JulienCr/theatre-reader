/**
 * Clé phonétique française : deux mots qui sonnent pareil la partagent.
 *
 * La reconnaissance vocale rend un SON sous forme de lettres, et le choix des
 * lettres lui appartient. « Dans chevelure, y'a pas de o » revient transcrite
 * « …pas de haut » : l'acteur a dit exactement le bon mot, la machine en a écrit
 * un autre. Comparer les lettres donne alors 25 % de similarité pour une réplique
 * parfaite, et c'est le seuil — pas la justesse — qui décide de la valider.
 *
 * Cette clé sert UNIQUEMENT à rapprocher deux mots (cf. `similarity`), jamais à
 * les identifier : une approximation ne peut donc rien casser de plus qu'un mot
 * jugé trop proche d'un autre, là où l'absence de phonétique refusait des
 * répliques justes — `vers`/`vert`/`verre`, `c'est`/`ses`/`ces`, `a`/`à`, chacun
 * coûtant une tentative.
 *
 * Ce n'est pas une transcription phonétique : pas d'API, pas de liaisons, pas de
 * mots grammaticaux traités à part. Le but est de regrouper les homophones
 * courants sans jamais fusionner deux mots réellement distincts — d'où les
 * marqueurs en majuscule, qui protègent un son déjà décidé des règles suivantes.
 */

/** Voyelles après transformation, marqueurs compris — sert aux règles contextuelles. */
const V = 'aeiouyUEW';
/** Voyelles ET nasales : ce qui suffit à faire un mot prononçable. */
const VOWELISH = new RegExp(`[${V}AIO]`);

/**
 * Consonnes finales muettes. `r` et `l` n'en sont pas — sans quoi « ver » et « vé »
 * se confondraient. La règle ne vaut QUE sur la finale d'origine : après la chute
 * d'un `e` muet, la consonne dégagée se prononce (« chose » se dit /ʃoz/).
 */
const MUTE_FINAL = /[dtsxzpg]$/;

export function phoneticKey(word: string): string {
  // Les nombres canoniques (`#22`) n'ont pas de graphie à interpréter.
  if (word.startsWith('#')) return word;

  let w = word.replace(/'/g, '');
  if (!w) return '';

  // Digrammes à h AVANT la chute du h muet, sinon `ch` deviendrait `c`.
  w = w
    .replace(/ch|sh/g, 'S')
    .replace(/ph/g, 'f')
    .replace(/th/g, 't')
    .replace(/h/g, '');

  // `x` final muet AVANT de devenir `ks` : « peux » doit rejoindre « peu ».
  w = w.replace(/x$/, '');

  // Consonnes contextuelles avant toute transformation de voyelle : c'est la
  // voyelle SUIVANTE qui décide du son de `c` et `g`, et les nasales l'effacent
  // (« cent » se serait durci en /kɑ̃/).
  w = w
    .replace(/gn/g, 'N')
    .replace(/qu?/g, 'k')
    .replace(/g(?=[eiy])/g, 'j')
    .replace(/c(?=[eiy])/g, 's')
    .replace(/c/g, 'k')
    .replace(/x/g, 'ks')
    .replace(/y/g, 'i')
    .replace(/w/g, 'v');

  // Nasales en -ain/-ein : traitées avant que `ai` ne devienne `e` et ne les
  // confonde avec la nasale de « an ». « pain » et « pan » ne sonnent pas pareil.
  w = w.replace(/(?:ai|ei)[nm](?![aeiou]|[nm])/g, 'I');

  w = w
    .replace(/eaus?|au[sdt]?(?![aeiou])/g, 'o')
    .replace(/oeu|eu/g, 'E')
    .replace(/ou/g, 'U')
    .replace(/oi/g, 'Wa')
    .replace(/ai|ei/g, 'e');

  // `s` sonore entre voyelles, AVANT les nasales : une fois « on » réduit à `O`,
  // le contexte intervocalique n'est plus visible et « poison » rejoindrait
  // « poisson ». Le `ss` est protégé en `Z` le temps de la règle.
  w = w
    .replace(/ss/g, 'Z')
    .replace(new RegExp(`([${V}])s(?=[${V}])`, 'g'), '$1z')
    .replace(/Z/g, 's');

  // Nasales restantes. Une voyelle ou un second n/m derrière rend la syllabe
  // orale : « ami » n'est pas « an », « année » n'est pas « an-née ».
  const open = `(?![${V}]|[nm])`;
  w = w
    .replace(new RegExp(`[ae][nm]${open}`, 'g'), 'A')
    .replace(new RegExp(`[iu][nm]${open}`, 'g'), 'I')
    .replace(new RegExp(`o[nm]${open}`, 'g'), 'O');

  // Consonnes doublées : sans effet sur le son.
  w = w.replace(/([bdfgjklmnprstvz])\1/g, '$1');

  // Finales muettes d'abord (« vert » → « ver », « jamais » → « jame »), et
  // seulement ensuite le `e` muet — l'inverse mangerait le `z` de « chose ».
  // Aucune des deux ne peut retirer la dernière voyelle : « mes » s'arrête à
  // « me » et « de » à « de », sans quoi les deux se réduiraient à une consonne
  // seule et se confondraient avec tout ce qui commence pareil.
  const trim = (re: RegExp): void => {
    for (;;) {
      const next = w.replace(re, '');
      if (next === w || !VOWELISH.test(next)) break;
      w = next;
    }
  };
  if (!w.endsWith('e')) trim(MUTE_FINAL);
  trim(/e$/);

  return w || word;
}
