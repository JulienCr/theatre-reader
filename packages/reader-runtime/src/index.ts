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

function injectStyle(css: string): void {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
}

function init(d: ReaderData): void {
  const play = document.querySelector<HTMLElement>('.play');
  if (!play) return;

  injectStyle(STYLE);
  // Le CSS des notes n'est utile que si l'export en embarque.
  if (d.notes && d.notes.length) injectStyle(annotationCss);

  // La recherche mute `.play` (injection de <mark>) : elle est créée ici, sur le
  // DOM de la pièce, et seulement pilotée depuis le chrome.
  const search = createSearch(play);

  const defaults: PersistedState = {
    selected: d.highlightsDefault.map((h) => h.characterId),
    fontPct: 100,
    reading: { ...DEFAULT_READING },
    myRoles: d.audio?.myCharacterId ? [d.audio.myCharacterId] : [],
  };
  const initial = loadState(d.storageKey, defaults);

  const host = document.createElement('div');
  host.id = 'reader-chrome';
  document.body.appendChild(host);
  createRoot(host).render(createElement(Chrome, { data: d, play, search, initial }));
}

export function boot(): void {
  const d = (window as unknown as { __THEATRE_READER_DATA__?: ReaderData }).__THEATRE_READER_DATA__;
  if (!d) return;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => init(d));
  } else {
    init(d);
  }
}
