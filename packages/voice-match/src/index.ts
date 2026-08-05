/**
 * Comparaison d'une tirade dite à voix haute avec le texte de la pièce.
 *
 * Paquet PUR : ni DOM, ni micro, ni permission — il reçoit deux chaînes et rend un
 * verdict. C'est là que vit tout le sens du mode de répétition vocale, et c'est la
 * seule couche vérifiable sans téléphone : la machine à états (@theatre/audio-player)
 * et le plugin natif ne font que l'alimenter.
 *
 * Les didascalies n'ont pas à être filtrées ici : le texte attendu vient des
 * `.speech` du rendu de @theatre/core, qui les excluent déjà.
 */
export { evaluate, tokenize } from './evaluate';
export type { EvaluatedWord, Evaluation, Tolerance, Verdict } from './evaluate';
export { matchCommand } from './commands';
export type { VoiceCommand } from './commands';
export { fold, splitWords, FILLERS } from './normalize';
export type { Token } from './normalize';
export { canonicalizeNumbers } from './numbers';
export { phoneticKey } from './phonetic';
export { align, similarity } from './align';
export type { Op } from './align';
export { blocks, weightOf, CRITICAL } from './weight';
