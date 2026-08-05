/**
 * Commandes dites à voix haute pendant la pause de répétition.
 *
 * Le micro est déjà ouvert au moment où c'est à moi de parler, et rien ne joue :
 * c'est le seul instant de la lecture où l'on peut demander quelque chose sans
 * reposer le texte. Quatre ordres y sont reconnus — sauter la réplique, se faire
 * souffler son début, reprendre la scène, passer à la suivante.
 *
 * Module PUR, comme le reste du paquet : il reçoit deux chaînes (ce qui a été
 * entendu, ce qui était attendu) et rend une commande ou rien.
 *
 * ── Deux règles, et tout le reste en découle ─────────────────────────────────
 *
 * 1. La commande est l'énoncé ENTIER. « passe la porte » n'est pas « passe » :
 *    un mot de plus et ce n'est plus un ordre, c'est du texte. L'appelant ne
 *    consulte donc ce module qu'une fois l'énoncé terminé — juger un résultat
 *    partiel couperait la parole à qui commence sa réplique par « Passe… ».
 *
 * 2. En cas de collision, la PIÈCE gagne. Si les mots de la commande figurent
 *    dans la tirade attendue, la commande est désactivée pour cette tirade-là :
 *    sur « Je passe par là, et je te croise », dire « passe » est un faux départ,
 *    pas une demande de sauter. Les autres formulations restent disponibles, et
 *    les boutons du lecteur aussi.
 */
import { tokenize } from './evaluate';
import { FILLERS, type Token } from './normalize';

export type VoiceCommand = 'skip' | 'hint' | 'scene-start' | 'scene-next';

/**
 * Les formulations acceptées, par commande.
 *
 * Plusieurs par ordre, et à dessein : c'est ce qui laisse une issue quand l'une
 * d'elles entre en collision avec la tirade (règle 2). Une pièce qui dit « passe »
 * laisse « suivant » ; une qui dit « on reprend » laisse « début de la scène ».
 *
 * La comparaison étant phonétique, il est inutile d'y aligner les accents ou les
 * élisions : « scene suivante » et « scène suivante » produisent la même clé.
 */
const PHRASES: Record<VoiceCommand, string[]> = {
  skip: ['passe', 'passer', 'on passe', 'suivant'],
  hint: ['indice', 'aide', 'aide-moi'],
  'scene-start': ['début de la scène', 'reprends la scène', 'on reprend'],
  'scene-next': ['scène suivante', 'prochaine scène'],
};

/** Suite de clés phonétiques d'une formulation, préparée une fois pour toutes. */
interface Phrase {
  command: VoiceCommand;
  keys: string[];
}

const CATALOG: Phrase[] = Object.entries(PHRASES).flatMap(([command, forms]) =>
  forms.map((form) => ({ command: command as VoiceCommand, keys: keysOf(tokenize(form)) })),
);

/**
 * Sur la clé phonétique et non sur `key` : la dictée écrit ce qu'elle entend, et
 * « indices », « indisse », « aide moi » doivent tous ouvrir la même porte. C'est
 * la même raison qui fait vivre `phonetic.ts` du côté de l'évaluation.
 */
function keysOf(tokens: Token[]): string[] {
  return tokens.map((t) => t.phon);
}

/** Vrai quand `needle` apparaît telle quelle, d'un seul tenant, dans `hay`. */
function contains(hay: string[], needle: string[]): boolean {
  if (!needle.length || needle.length > hay.length) return false;
  for (let i = 0; i + needle.length <= hay.length; i++) {
    if (needle.every((k, j) => hay[i + j] === k)) return true;
  }
  return false;
}

/**
 * La commande contenue dans `heard`, ou `null` si ce n'en est pas une.
 *
 * `expectedText` est la tirade attendue : elle sert uniquement à écarter les
 * collisions (règle 2). La passer vide revient à n'en écarter aucune.
 */
export function matchCommand(heard: string, expectedText: string): VoiceCommand | null {
  // Les hésitations sont retirées de ce qui est ENTENDU seulement, comme dans
  // l'évaluation : « euh… passe » reste un ordre, et une pièce qui écrit
  // réellement « euh » garde le droit de l'attendre.
  const said = keysOf(tokenize(heard).filter((t) => !FILLERS.has(t.key)));
  if (!said.length) return null;

  const expected = keysOf(tokenize(expectedText));
  for (const p of CATALOG) {
    if (p.keys.length !== said.length) continue;
    if (!p.keys.every((k, i) => k === said[i])) continue;
    if (contains(expected, p.keys)) return null;
    return p.command;
  }
  return null;
}
