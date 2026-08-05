/**
 * Adresse du serveur Theatre Reader, vue depuis le téléphone.
 *
 * Une base configurable plutôt que des URL relatives : sous Capacitor la WebView
 * charge `capacitor://localhost`, les appels ne sont donc plus same-origin et
 * doivent viser explicitement la machine qui héberge les pièces.
 *
 * Deux origines, délibérément distinctes :
 *
 * - l'adresse MANUELLE (Tailscale), persistée, saisie une fois — elle marche
 *   partout, y compris en 4G, et reste prioritaire pour cette raison ;
 * - l'adresse DÉCOUVERTE sur le réseau local, qui ne vit qu'en mémoire. La
 *   persister n'aurait aucun sens : elle est vraie sur le Wi-Fi de la maison et
 *   fausse ailleurs, et on la retrouve en une requête au lancement.
 *
 * `apiUrl()` reste synchrone : tout `api.ts` l'appelle en ligne droite, et la
 * découverte se contente de poser `activeBase` avant le premier appel.
 */

const KEY = 'theatre:apiBase';

/** Base découverte, valable le temps de la session. */
let activeBase: string | null = null;

/** Adresse saisie à la main, sans `/` final, ou chaîne vide si jamais renseignée. */
export function getManualBase(): string {
  return normalize(localStorage.getItem(KEY) ?? '');
}

export function setManualBase(url: string): void {
  localStorage.setItem(KEY, normalize(url));
}

/** Posée par la découverte ; `null` remet l'app sur la seule adresse manuelle. */
export function setActiveBase(url: string | null): void {
  activeBase = url === null ? null : normalize(url);
}

/** Base réellement utilisée par les appels API. */
export function getApiBase(): string {
  return activeBase ?? getManualBase();
}

/** `path` commence par `/` : `apiUrl('/api/plays')`. */
export function apiUrl(path: string): string {
  return getApiBase() + path;
}

function normalize(url: string): string {
  return url.trim().replace(/\/+$/, '');
}
