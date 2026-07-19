/**
 * @theatre/reader-ui — comportements et composants du lecteur, partagés entre
 * le lecteur web (React) et le lecteur mobile exporté.
 *
 * Règle du paquet : rien ici ne possède le HTML de la pièce. Ce HTML vient de
 * `renderBody` (@theatre/core) et il est muté impérativement par `decorate()`
 * (annotations), `createPlayer()` (audio) et la recherche ci-dessous. Les
 * composants de chrome viendront s'ajouter ici, montés à côté du texte, jamais
 * autour de lui.
 */
export {
  createSearch,
  MIN_QUERY_LENGTH,
  type SearchController,
} from './search';
