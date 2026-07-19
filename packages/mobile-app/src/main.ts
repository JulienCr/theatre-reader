/**
 * Point d'entrée du lecteur mobile autonome (Vite + Preact).
 *
 * Même runtime que le .html exporté (@theatre/reader-runtime) : on se contente
 * de reconstituer, à l'exécution et depuis l'API, ce que l'export assemble au
 * build — le HTML de la pièce, son CSS, et le bloc de données du runtime.
 */

import { boot } from '@theatre/reader-runtime';
import { buildReaderDocument, type ReaderDocument } from '@theatre/reader-ui';
import { uiCss } from '@theatre/ui';
import { buildOnlineClips, loadNotes, loadPlay } from './api';
import { getApiBase } from './settings';

declare global {
  interface Window {
    __THEATRE_READER_DATA__?: ReaderDocument['data'];
  }
}

/**
 * Neutralise la pagination du rendu partagé avec le PDF : sur téléphone on lit
 * en flux continu, les numéros de page de la table et les sauts n'ont pas de sens.
 */
const REFLOW_CSS = `
.toc-item a::after { content: none !important; }
.toc, .distribution--break { break-after: auto; }
`;

function injectStyle(css: string): void {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
}

function mountReader(doc: ReaderDocument): void {
  injectStyle(uiCss);
  injectStyle(doc.css);
  injectStyle(REFLOW_CSS);

  const app = document.getElementById('app');
  if (!app) throw new Error('#app introuvable');
  app.innerHTML = doc.body;
  window.__THEATRE_READER_DATA__ = doc.data;
  document.title = doc.title;

  // EN DERNIER, impérativement : `boot()` cherche `.play` dans le DOM et lit le
  // global, une seule fois chacun, et retourne EN SILENCE si l'un des deux
  // manque — l'écran resterait blanc sans la moindre erreur.
  boot();
}

async function main(): Promise<void> {
  const slug = new URLSearchParams(location.search).get('slug');
  // Ni serveur configuré ni pièce demandée : rien à afficher. L'écran de choix
  // (liste des pièces, réglage de l'adresse) viendra dans une étape ultérieure.
  if (!getApiBase() || !slug) return;

  const { fountain, meta } = await loadPlay(slug);
  const notes = await loadNotes(slug);
  const clips = await buildOnlineClips(slug, fountain, meta);

  mountReader(
    buildReaderDocument({
      fountain,
      characters: meta.characters,
      template: meta.template,
      notes,
      storageKey: `theatre-reader:${slug}`,
      clips,
      myCharacterId: meta.audio?.myCharacterId,
    }),
  );
}

main().catch((err: unknown) => {
  // Sur un téléphone il n'y a pas de console : l'échec doit rester lisible à l'écran.
  console.error(err);
  const app = document.getElementById('app');
  if (app) app.textContent = `Erreur : ${err instanceof Error ? err.message : String(err)}`;
});
