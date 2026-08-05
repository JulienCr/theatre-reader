/**
 * Construction du « document lecteur » : le HTML de la pièce, son CSS et le bloc
 * de données que le runtime consomme (`window.__THEATRE_READER_DATA__`).
 *
 * Source unique partagée par l'export HTML autonome (@theatre/server, au build)
 * et le lecteur mobile (à l'exécution). Deux constructions parallèles finiraient
 * par diverger, et une divergence ici ne se voit qu'à l'exécution sur le
 * téléphone.
 *
 * Ceci n'enfreint pas la règle du paquet (« rien ici ne possède le HTML de la
 * pièce », cf. `index.ts`) : cette règle vise la POSSESSION et la MUTATION du
 * DOM par les composants. `buildReaderDocument` est une fonction pure — elle
 * produit des chaînes et les remet à l'appelant, qui reste seul maître du
 * document.
 */
import {
  buildToc,
  parseFountain,
  renderBody,
  renderCSS,
  sceneMembers,
  type Character,
  type EmbeddedSceneMember,
  type Note,
  type Template,
} from '@theatre/core';

/**
 * Clé localStorage sous laquelle le lecteur garde l'état d'une pièce — surlignages,
 * taille du texte, réglages de répétition, position de lecture.
 *
 * Ici et nulle part ailleurs : elle est fabriquée par les deux producteurs de
 * documents (l'export .html du serveur et l'app mobile) et RELUE par l'écran
 * d'accueil de l'app pour proposer la reprise. Trois copies de la même chaîne, et
 * la première divergence casse la reprise sans un message d'erreur.
 */
export function storageKeyFor(slug: string): string {
  return `theatre-reader:${slug}`;
}

export interface ReaderData {
  characters: { id: string; name: string }[];
  toc: { id: string; label: string; scene: boolean }[];
  /**
   * Personnages présents par plage — scènes, prologues d'acte et tête de pièce
   * (id = celui du sommaire pour les plages qui ont un en-tête). Alimente
   * `sceneVisibility` pour l'option « n'afficher que mes scènes ».
   *
   * Typé sur la forme LUE (`kind` optionnel) et non produite : ce bloc est
   * sérialisé dans les .html exportés, dont certains sont antérieurs à `kind`.
   */
  sceneMembers: EmbeddedSceneMember[];
  highlightsDefault: { characterId: string; color: string }[];
  notes?: Note[];
  storageKey: string;
  /** Audio (opt-in) : nodeId -> URL du clip, + mon rôle. */
  audio?: { clips: Record<string, string>; myCharacterId?: string };
}

export interface ReaderDocumentInput {
  fountain: string;
  characters: Character[];
  template: Template;
  notes?: Note[];
  storageKey: string;
  /** nodeId -> URL du clip. OPAQUE ici : data URI (export), URL serveur ou fichier local (app). */
  clips?: Record<string, string>;
  myCharacterId?: string;
}

export interface ReaderDocument {
  body: string;
  css: string;
  data: ReaderData;
  title: string;
}

export function buildReaderDocument(input: ReaderDocumentInput): ReaderDocument {
  const play = parseFountain(input.fountain, input.characters);
  const body = renderBody(play, input.template);
  const css = renderCSS(input.template);
  const toc = buildToc(play, input.template).map((e) => ({ id: e.id, label: e.label, scene: e.scene }));
  const title = play.title ?? 'Pièce';

  // Sans clip, pas de clé `audio` du tout : le runtime teste
  // `Object.keys(d.audio.clips).length` avant de câbler la lecture, et l'export
  // vérifie l'absence littérale du bloc.
  const clips = input.clips;
  const audio = clips && Object.keys(clips).length ? { clips, myCharacterId: input.myCharacterId } : undefined;

  const data: ReaderData = {
    characters: play.characters.map((c) => ({ id: c.id, name: c.canonicalName })),
    toc,
    sceneMembers: sceneMembers(play),
    highlightsDefault: input.template.highlights.map((h) => ({
      characterId: h.characterId,
      color: h.color,
    })),
    notes: input.notes ?? [],
    storageKey: input.storageKey,
    ...(audio ? { audio } : {}),
  };

  return { body, css, data, title };
}
