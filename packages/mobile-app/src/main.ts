/**
 * Point d'entrée du lecteur mobile autonome (Vite + Preact).
 *
 * Même runtime que le .html exporté (@theatre/reader-runtime) : on se contente
 * de reconstituer, à l'exécution et depuis l'API, ce que l'export assemble au
 * build — le HTML de la pièce, son CSS, et le bloc de données du runtime.
 */

import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Note } from '@theatre/core';
import { boot } from '@theatre/reader-runtime';
import { buildReaderDocument, type ReaderDocument } from '@theatre/reader-ui';
import { uiCss } from '@theatre/ui';
import { buildOnlineClips, loadNotes, loadPlay, type PlayMeta } from './api';
import { buildOfflineClips } from './offline/prepare';
import * as store from './offline/store';
import { Picker, pickerCss } from './ui/Picker';

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

/** Tout ce qu'il faut pour monter le lecteur, quelle que soit la provenance. */
interface PlaySource {
  fountain: string;
  meta: PlayMeta;
  notes: Note[];
  clips: Record<string, string>;
}

function injectStyle(css: string): void {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
}

function appRoot(): HTMLElement {
  const app = document.getElementById('app');
  if (!app) throw new Error('#app introuvable');
  return app;
}

function mountReader(doc: ReaderDocument): void {
  injectStyle(uiCss);
  injectStyle(doc.css);
  injectStyle(REFLOW_CSS);

  const app = appRoot();
  app.innerHTML = doc.body;
  window.__THEATRE_READER_DATA__ = doc.data;
  document.title = doc.title;

  // EN DERNIER, impérativement : `boot()` cherche `.play` dans le DOM et lit le
  // global, une seule fois chacun, et retourne EN SILENCE si l'un des deux
  // manque — l'écran resterait blanc sans la moindre erreur.
  boot();
}

function mountPicker(): void {
  injectStyle(uiCss);
  injectStyle(pickerCss);
  createRoot(appRoot()).render(createElement(Picker));
}

/**
 * Copie locale, ou `null` si la pièce n'a jamais été préparée sur ce téléphone.
 *
 * La présence se juge sur la copie elle-même, JAMAIS sur le nombre de clips : un
 * `clips` vide est un état parfaitement normal — pièce dont aucun personnage n'a
 * de voix configurée, ou dont tous les clips manquaient au cache serveur (le
 * compteur `missing` de `prepareOffline` existe précisément pour ce cas). Le
 * texte et les notes, eux, SONT sur le téléphone : exiger de l'audio renverrait
 * au serveur une pièce pourtant téléchargée, donc illisible Mac éteint — soit
 * l'inverse exact de la promesse du produit.
 *
 * Rien à faire de spécial en aval : `buildReaderDocument` omet le bloc `audio`
 * quand `clips` est vide, et le lecteur s'affiche en texte seul.
 */
async function loadLocalSource(slug: string): Promise<PlaySource | null> {
  const stored = await store.loadPlay(slug);
  if (!stored) return null;
  const clips = await buildOfflineClips(slug);
  return { ...stored, notes: await store.loadNotes(slug), clips };
}

async function loadServerSource(slug: string): Promise<PlaySource> {
  const { fountain, meta } = await loadPlay(slug);
  const notes = await loadNotes(slug);
  const clips = await buildOnlineClips(slug, fountain, meta);
  return { fountain, meta, notes, clips };
}

/**
 * Local d'abord, serveur en secours.
 *
 * C'est l'ordre du mode nominal : en répétition — métro, coulisses, Mac éteint —
 * l'ouverture doit être instantanée et ne dépendre d'aucun réseau. Le serveur
 * n'intervient que pour une pièce jamais préparée.
 */
async function openPlay(slug: string): Promise<void> {
  const source = (await loadLocalSource(slug)) ?? (await loadServerSource(slug));
  mountReader(
    buildReaderDocument({
      fountain: source.fountain,
      characters: source.meta.characters,
      template: source.meta.template,
      notes: source.notes,
      storageKey: `theatre-reader:${slug}`,
      clips: source.clips,
      myCharacterId: source.meta.audio?.myCharacterId,
    }),
  );
}

async function main(): Promise<void> {
  const slug = new URLSearchParams(location.search).get('slug');
  if (!slug) {
    mountPicker();
    return;
  }
  await openPlay(slug);
}

main().catch((err: unknown) => {
  // Sur un téléphone il n'y a pas de console : l'échec doit rester lisible à l'écran.
  console.error(err);
  const app = document.getElementById('app');
  if (app) app.textContent = `Erreur : ${err instanceof Error ? err.message : String(err)}`;
});
