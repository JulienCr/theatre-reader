/**
 * Préférence de thème.
 *
 * Rien à calculer côté JS : les jetons de @theatre/ui commutent déjà sur
 * `prefers-color-scheme` et sur `:root[data-theme]`. Poser (ou retirer)
 * l'attribut suffit — l'absence d'attribut *est* le mode « système ».
 */
export type ThemePref = 'system' | 'light' | 'dark';

const KEY = 'theatre.theme';

export function loadTheme(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(pref: ThemePref) {
  const root = document.documentElement;
  if (pref === 'system') root.removeAttribute('data-theme');
  else root.dataset.theme = pref;
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    // Mode privé / stockage refusé : le thème reste appliqué pour la session.
  }
}
