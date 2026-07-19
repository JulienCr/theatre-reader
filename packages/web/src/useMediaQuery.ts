import { useEffect, useState } from 'react';

/**
 * Suit une media query côté JS.
 *
 * Le dock ne peut pas basculer en sheet par CSS seul : colonne et sheet n'ont ni
 * le même arbre React ni le même parent (la sheet est en `position: fixed`, hors
 * du groupe redimensionnable). Il faut donc que le composant sache, et non
 * seulement la feuille de style.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const sync = () => setMatches(mq.matches);
    // Re-synchronise à l'abonnement : la largeur a pu changer entre le premier
    // rendu et cet effet.
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, [query]);
  return matches;
}
