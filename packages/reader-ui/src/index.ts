/**
 * @theatre/reader-ui — comportements et composants du lecteur, partagés entre
 * le lecteur web (React) et le lecteur mobile exporté.
 *
 * Règle du paquet : rien ici ne possède le HTML de la pièce. Ce HTML vient de
 * `renderBody` (@theatre/core) et il est muté impérativement par `decorate()`
 * (annotations), `createPlayer()` (audio) et la recherche ci-dessous. Les
 * composants de chrome viennent s'ajouter ici, montés à côté du texte, jamais
 * autour de lui.
 *
 * Les composants sont **présentationnels** : ils ne touchent ni au `Player` ni
 * au DOM de la pièce, tout passe par des props. C'est ce qui les rend
 * composables aussi bien par le lecteur mobile que par le lecteur web, dont les
 * barres n'ont ni le même agencement ni les mêmes contraintes.
 */
export {
  createSearch,
  MIN_QUERY_LENGTH,
  type SearchController,
} from './search';
export { ContextBanner, type ContextBannerProps } from './ContextBanner';
export { TransportDock, type TransportDockProps } from './TransportDock';
export { readerChromeCss } from './chrome-css';
