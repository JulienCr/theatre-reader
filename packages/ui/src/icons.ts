/**
 * Jeu d'icônes minimal, partagé web ↔ lecteur mobile exporté.
 *
 * Des chemins SVG bruts plutôt qu'une librairie : le lecteur mobile est un
 * `.html` autonome hors-ligne, il ne peut charger ni police d'icônes ni sprite
 * distant, et l'ancienne barre utilisait des emoji (rendu incohérent d'un
 * appareil à l'autre, taille non maîtrisée).
 *
 * Convention : grille 24×24, tracé au trait (`stroke: currentColor`), sauf les
 * icônes listées dans `FILLED_ICONS` qui sont des aplats — un transport audio se
 * lit mieux plein.
 */

export const ICONS = {
  // Transport audio
  play: 'M8 5.2v13.6L19 12z',
  pause: 'M9 5h2.2v14H9zM12.8 5H15v14h-2.2z',
  // Les barres des icônes de saut sont des rectangles, pas des traits : elles
  // sont rendues en aplat (cf. FILLED_ICONS) et un trait n'a aucune aire.
  'skip-back': 'M18 5.5v13L9 12zM6 5h2.2v14H6z',
  'skip-forward': 'M6 5.5v13L15 12zM15.8 5H18v14h-2.2z',

  // Navigation / structure
  menu: 'M4 7h16M4 12h16M4 17h16',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4.2-4.2',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  users:
    'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M2.5 20a6.5 6.5 0 0 1 13 0M16.5 4.3a4 4 0 0 1 0 7.4M18 14.6a6.5 6.5 0 0 1 3.5 5.4',
  'chevron-down': 'M6 9.5l6 6 6-6',
  'chevron-right': 'M9.5 6l6 6-6 6',
  'chevron-left': 'M14.5 6l-6 6 6 6',
  x: 'M6.5 6.5l11 11M17.5 6.5l-11 11',
  'more-horizontal': 'M5 12h.01M12 12h.01M19 12h.01',

  // Réglages
  sliders: 'M4 7h6M14 7h6M4 17h10M18 17h2M12 4.6v4.8M16 14.6v4.8',
  type: 'M4.5 19L11 5h2l6.5 14M7.6 14h8.8',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  palette: 'M12 3.2C12 3.2 18 9.6 18 13.4a6 6 0 0 1-12 0C6 9.6 12 3.2 12 3.2z',

  // Documents & actions
  'sticky-note': 'M4.5 4h10l5 5v11h-15zM14.5 4v5h5',
  download: 'M12 4v11M7.5 11l4.5 4.5 4.5-4.5M4.5 20h15',
  save: 'M5 4h11l3 3v13H5zM8.5 4v5h6.5V4M8 13h8v7H8z',
  mic: 'M12 3.5a2.8 2.8 0 0 1 2.8 2.8v5.4a2.8 2.8 0 0 1-5.6 0V6.3A2.8 2.8 0 0 1 12 3.5zM5.5 11.4a6.5 6.5 0 0 0 13 0M12 18v2.5',
  volume: 'M11 5.5L6.5 9.5H3.5v5h3l4.5 4zM15 9.4a3.6 3.6 0 0 1 0 5.2',

  // Affichage
  maximize: 'M8.5 3.5H5.5a2 2 0 0 0-2 2v3M15.5 3.5h3a2 2 0 0 1 2 2v3M20.5 15.5v3a2 2 0 0 1-2 2h-3M3.5 15.5v3a2 2 0 0 0 2 2h3',
  help: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM9.6 9.4a2.5 2.5 0 0 1 4.9.6c0 1.7-2.5 2.2-2.5 3.6M12 17h.01',
} as const;

export type IconName = keyof typeof ICONS;

/** Icônes rendues en aplat (`fill`) plutôt qu'au trait. */
export const FILLED_ICONS: ReadonlySet<string> = new Set([
  'play',
  'pause',
  'skip-back',
  'skip-forward',
]);
