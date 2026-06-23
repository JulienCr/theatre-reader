/**
 * Étape LLM (Anthropic / Claude) de la pipeline d'import : normalisation des
 * noms de personnages (regroupement des coquilles, choix du nom canonique).
 *
 * Tâche volontairement ciblée et peu coûteuse — on n'envoie que la liste des
 * orthographes de cues + les noms déclarés, pas tout le texte. Le repli sans IA
 * (`fuzzyMerge`) prend le relais en l'absence de clé ou en cas d'erreur.
 */

import Anthropic from '@anthropic-ai/sdk';
import { DeclaredCharacter } from './heuristics';
import { CharacterMapping, CueCount } from './characters';

export const DEFAULT_MODEL = process.env.THEATRE_LLM_MODEL ?? 'claude-sonnet-4-6';

export function hasApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function buildPrompt(cues: CueCount[], declared: DeclaredCharacter[]): string {
  return `Tu structures une pièce de théâtre en français.

Personnages annoncés dans la DISTRIBUTION :
${declared.map((d) => `- ${d.name}`).join('\n') || '(aucun)'}

Orthographes de noms trouvées en tête des répliques (avec nombre d'occurrences) :
${cues.map((c) => `- ${c.name} (${c.count})`).join('\n') || '(aucune)'}

Regroupe les orthographes qui désignent le MÊME personnage en corrigeant les
coquilles d'OCR (exemples : GIUSEPPPE = GIUSEPPE, BENII = BENJI, GERALD =
GERALD PRANCOIS). Pour chaque personnage, choisis un nom canonique COURT, de
préférence celui utilisé dans les répliques.

Réponds UNIQUEMENT avec un tableau JSON valide, sans texte autour :
[{"canonicalName": "GERALD", "aliases": ["GERALD", "GERALD PRANCOIS"], "description": "..."}]
- "aliases" doit contenir TOUTES les orthographes (cues + nom déclaré) du personnage.
- "description" = la description de la DISTRIBUTION si elle existe, sinon omets-la.`;
}

function extractJsonArray(text: string): string {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('Réponse LLM sans tableau JSON');
  }
  return text.slice(start, end + 1);
}

export async function llmMergeCharacters(
  cues: CueCount[],
  declared: DeclaredCharacter[],
  model: string = DEFAULT_MODEL,
): Promise<CharacterMapping> {
  const client = new Anthropic();
  const res = await client.messages.create({
    model,
    max_tokens: 2000,
    messages: [{ role: 'user', content: buildPrompt(cues, declared) }],
  });
  const text = res.content
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('');
  const parsed = JSON.parse(extractJsonArray(text)) as CharacterMapping;
  if (!Array.isArray(parsed) || parsed.some((c) => typeof c.canonicalName !== 'string')) {
    throw new Error('Format de mapping LLM invalide');
  }
  return parsed.map((c) => ({
    canonicalName: c.canonicalName,
    aliases: Array.isArray(c.aliases) && c.aliases.length ? c.aliases : [c.canonicalName],
    description: c.description,
  }));
}
