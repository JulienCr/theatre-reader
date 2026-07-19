/**
 * Session de travail par appareil (pièce ouverte + mode Édition/Lecture).
 *
 * Même nature que `readingPrefs` — un réglage propre au poste, pas à la
 * production : il vit dans le localStorage et jamais dans `meta.json`, qui est
 * partagé et versionné avec la pièce. La clé est globale (et non par pièce)
 * parce que c'est justement *quelle* pièce était ouverte que l'on mémorise.
 */

export type AppMode = 'edit' | 'read';

export interface SessionPrefs {
  /** Slug de la dernière pièce ouverte, ou null si aucune. */
  slug: string | null;
  mode: AppMode;
}

const KEY = 'theatre-reader:session';

const DEFAULTS: SessionPrefs = { slug: null, mode: 'edit' };

/**
 * Lit la session mémorisée. Tolérante aux champs manquants ou corrompus : un
 * localStorage écrit par une version antérieure ne doit jamais empêcher
 * l'application de démarrer.
 *
 * Le slug renvoyé n'est pas garanti valide — c'est à l'appelant de vérifier
 * qu'il figure encore dans la liste des pièces (une pièce peut avoir été
 * supprimée entre deux sessions) et de l'ignorer silencieusement sinon.
 */
export function loadSessionPrefs(): SessionPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const p = JSON.parse(raw) as { slug?: unknown; mode?: unknown };
    return {
      slug: typeof p.slug === 'string' && p.slug ? p.slug : DEFAULTS.slug,
      mode: p.mode === 'read' || p.mode === 'edit' ? p.mode : DEFAULTS.mode,
    };
  } catch {
    return DEFAULTS;
  }
}

export function saveSessionPrefs(prefs: SessionPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* localStorage indisponible (mode privé, quota) : la session n'est pas mémorisée, rien de plus */
  }
}
