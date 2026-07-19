/**
 * Adresse du serveur Theatre Reader, choisie une fois puis persistée.
 *
 * Une base configurable plutôt que des URL relatives : sous Capacitor la WebView
 * charge `capacitor://localhost`, les appels ne sont donc plus same-origin et
 * doivent viser explicitement la machine qui héberge les pièces.
 */

const KEY = 'theatre:apiBase';

/** Base sans `/` final, ou chaîne vide si l'app n'est pas encore configurée. */
export function getApiBase(): string {
  return normalize(localStorage.getItem(KEY) ?? '');
}

export function setApiBase(url: string): void {
  localStorage.setItem(KEY, normalize(url));
}

/** `path` commence par `/` : `apiUrl('/api/plays')`. */
export function apiUrl(path: string): string {
  return getApiBase() + path;
}

function normalize(url: string): string {
  return url.trim().replace(/\/+$/, '');
}
