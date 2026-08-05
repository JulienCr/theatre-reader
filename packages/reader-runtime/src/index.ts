/**
 * Runtime du lecteur mobile autonome (navigateur, hors-ligne).
 *
 * Bundlé par esbuild (IIFE, globalName `TheatreReader`, React aliasé sur Preact)
 * et inliné dans le .html exporté. Pilote le HTML rendu par @theatre/core en
 * flux continu (reflow) : surlignage multi-perso, mode « mes répliques », saut
 * de scène, recherche, taille de texte, et affichage des notes (figées) en
 * lecture seule. Les données arrivent par window.__THEATRE_READER_DATA__.
 *
 * INVARIANT ABSOLU — React ne possède JAMAIS le texte de la pièce. Ce module
 * garde la main sur `.play` (rendu par @theatre/core, muté par les annotations,
 * le moteur audio et la recherche) et ne monte le chrome React que dans un
 * conteneur séparé, `#reader-chrome`, ajouté en fin de <body>. Cf. Chrome.tsx.
 */

import { annotationCss } from '@theatre/annotations';
import { createRoot } from 'react-dom/client';
import { createElement } from 'react';
import { createSearch } from '@theatre/reader-ui';
import { Chrome } from './Chrome';
import { DEFAULT_READING, loadState, type PersistedState } from './state';
import { STYLE } from './styles';
import type { ReaderData } from './types';

export type { ReaderData } from './types';
export { loadResume, type ResumePoint } from './state';

/**
 * Ce que l'hôte du runtime sait faire et que le lecteur, lui, ne peut pas deviner.
 *
 * `onExit` n'est fourni que par l'app : elle a une liste de pièces où revenir. Le
 * .html exporté est un fichier isolé — il n'y a rien derrière lui — et l'absence
 * de l'option y est donc la bonne réponse, pas un oubli : le chrome n'affiche
 * alors aucune sortie.
 */
export interface BootOptions {
  onExit?: () => void;
}

function injectStyle(css: string): void {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
}

function init(d: ReaderData, options: BootOptions): void {
  const play = document.querySelector<HTMLElement>('.play');
  if (!play) return;

  injectStyle(STYLE);
  // Le CSS des notes n'est utile que si l'export en embarque.
  if (d.notes && d.notes.length) injectStyle(annotationCss);

  // La recherche mute `.play` (injection de <mark>) : elle est créée ici, sur le
  // DOM de la pièce, et seulement pilotée depuis le chrome.
  const search = createSearch(play);

  // Les surlignages du template et le rôle de l'export alimentent la MÊME liste
  // depuis leur fusion : ce sont deux façons de désigner « les personnages de la
  // personne qui lit ».
  const mine = d.highlightsDefault.map((h) => h.characterId);
  const role = d.audio?.myCharacterId;
  const defaults: PersistedState = {
    selected: role && !mine.includes(role) ? [...mine, role] : mine,
    fontPct: 100,
    reading: { ...DEFAULT_READING },
  };
  const initial = loadState(d.storageKey, defaults);
  // Un personnage persisté qui n'existe plus dans la pièce (renommé, ou autre pièce
  // sous la même clé) n'appartient à aucune plage : « mes scènes » les masquerait
  // TOUTES et la pièce s'ouvrirait vide, sans rien pour l'expliquer.
  const known = new Set(d.characters.map((c) => c.id));
  initial.selected = initial.selected.filter((id) => known.has(id));

  const host = document.createElement('div');
  host.id = 'reader-chrome';
  document.body.appendChild(host);
  createRoot(host).render(
    createElement(Chrome, { data: d, play, search, initial, onExit: options.onExit }),
  );
}

export function boot(options: BootOptions = {}): void {
  const d = (window as unknown as { __THEATRE_READER_DATA__?: ReaderData }).__THEATRE_READER_DATA__;
  if (!d) return;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => init(d, options));
  } else {
    init(d, options);
  }
}
