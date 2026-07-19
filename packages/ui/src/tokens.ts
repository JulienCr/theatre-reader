/**
 * Jetons de design partagés — l'unique source des couleurs, espacements et
 * typographies de toutes les surfaces (app web, lecteur web, lecteur mobile
 * exporté).
 *
 * `tokensCss` est une **chaîne CSS**, pas un fichier `.css` : le lecteur mobile
 * est un `.html` autonome hors-ligne dont le style est inliné par
 * `reader-export.ts`, il ne peut donc pas importer de feuille. Le web injecte la
 * même chaîne. C'est ce qui garantit un seul langage visuel des deux côtés.
 *
 * ── Direction : « papier & encre » ────────────────────────────────────────────
 * L'outil sert à lire et répéter un texte de théâtre : le texte est le produit,
 * le chrome doit s'effacer. D'où deux surfaces distinctes, et pas une seule :
 *
 *   --paper   surfaces du chrome (barres, panneaux, sheets) — presque blanc, chaud
 *   --table   fond sur lequel *repose* la feuille A4 (aperçu, lecteur) — plus sourd
 *
 * La feuille rendue par @theatre/core reste blanc pur : elle doit se détacher du
 * chrome, jamais s'y fondre.
 *
 * ── Le rouge rideau, et où il a le droit d'apparaître ─────────────────────────
 * `--accent` est un rouge de rideau de scène. Il est **rare par construction** :
 *
 *   1. l'unique action primaire d'un écran (un seul bouton plein par vue) ;
 *   2. l'état « en scène » — réplique en cours de lecture, mode répétition actif,
 *      onglet/segment sélectionné.
 *
 * Partout ailleurs : encre et gris. Un écran où le rouge apparaît trois fois a
 * perdu son sens.
 *
 * ── Destructif ────────────────────────────────────────────────────────────────
 * L'accent étant déjà rouge, le danger ne peut pas se signaler par la couleur
 * seule. Convention : une action destructive est **toujours** en texte/contour
 * (jamais un aplat) et porte `--danger`. Forme différente = sens différent.
 */

export const tokensCss = `
:root {
  color-scheme: light dark;

  /* Surfaces */
  --paper: #FDFCF9;
  --paper-raised: #FFFFFF;
  --paper-sunken: #F4F1EA;
  --table: #E7E2D8;
  --rule: #DED8CC;
  --rule-strong: #C8C0B1;

  /* Encre */
  --ink: #1A1A1E;
  --ink-muted: #6E6A64;
  --ink-faint: #9C968C;

  /* Accent — rouge rideau (cf. règle d'usage en tête de fichier) */
  --accent: #8E2B2B;
  --accent-hover: #7A2424;
  --accent-ink: #FFF8F4;
  --accent-wash: #F6E9E6;

  /* Destructif — toujours en texte ou contour, jamais en aplat */
  --danger: #9B1B12;
  --ok: #1A7F37;
  --warn-wash: #F7E7BC;
  --warn-ink: #7A5B00;

  /* Surlignage de recherche — jaune de stabilo, hors du champ chromatique de
     l'accent pour ne pas se confondre avec l'état « en scène ». */
  --hit: #F5D97A;
  --hit-current: #E8A317;
  --hit-ink: #241C05;

  /* Voile des modales */
  --scrim: rgba(28, 22, 14, .38);

  /* Focus — visible sur papier comme sur accent */
  --focus-ring: 0 0 0 2px var(--paper), 0 0 0 4px var(--accent);

  /* Ombres — portées courtes, l'interface est posée à plat */
  --sh-1: 0 1px 2px rgba(26, 22, 14, .07);
  --sh-2: 0 2px 8px rgba(26, 22, 14, .10);
  --sh-3: 0 12px 40px rgba(26, 22, 14, .22);

  /* Espacement */
  --sp-1: 4px;
  --sp-2: 6px;
  --sp-3: 10px;
  --sp-4: 14px;
  --sp-5: 20px;
  --sp-6: 32px;

  /* Rayons */
  --r-sm: 5px;
  --r-md: 8px;
  --r-lg: 14px;
  --r-full: 999px;

  /* Typographie */
  --font-ui: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  --font-mono: 'SF Mono', ui-monospace, 'Cascadia Code', Menlo, monospace;
  --fs-xs: 11px;
  --fs-sm: 12px;
  --fs-md: 13px;
  --fs-lg: 15px;
  --fs-xl: 19px;
  /* Micro-libellés (titres de panneaux, en-têtes de colonnes) */
  --tracking-label: .06em;

  /* Contrôles */
  --ctl-h: 30px;
  --ctl-h-touch: 44px;
  --ctl-h-hero: 56px;
}

@media (prefers-color-scheme: dark) {
  :root {
    --paper: #17161A;
    --paper-raised: #201E24;
    --paper-sunken: #121115;
    --table: #0E0D10;
    --rule: #302D36;
    --rule-strong: #423E4A;

    --ink: #EDEAE4;
    --ink-muted: #9A948C;
    --ink-faint: #6B6670;

    --accent: #C4595A;
    --accent-hover: #D46B6C;
    --accent-ink: #1A1012;
    --accent-wash: #2A1C1E;

    --danger: #E0736A;
    --ok: #5FBF7E;
    --warn-wash: #3B3116;
    --warn-ink: #E7C877;

    --hit: #6E5A1E;
    --hit-current: #B98A17;
    --hit-ink: #F7EFD8;

    --scrim: rgba(0, 0, 0, .58);

    --sh-1: 0 1px 2px rgba(0, 0, 0, .5);
    --sh-2: 0 2px 8px rgba(0, 0, 0, .55);
    --sh-3: 0 12px 40px rgba(0, 0, 0, .7);
  }
}

/* Bascule manuelle : gagne toujours sur la préférence système. */
:root[data-theme='light'] {
  --paper: #FDFCF9;
  --paper-raised: #FFFFFF;
  --paper-sunken: #F4F1EA;
  --table: #E7E2D8;
  --rule: #DED8CC;
  --rule-strong: #C8C0B1;
  --ink: #1A1A1E;
  --ink-muted: #6E6A64;
  --ink-faint: #9C968C;
  --accent: #8E2B2B;
  --accent-hover: #7A2424;
  --accent-ink: #FFF8F4;
  --accent-wash: #F6E9E6;
  --danger: #9B1B12;
  --ok: #1A7F37;
  --warn-wash: #F7E7BC;
  --warn-ink: #7A5B00;
  --hit: #F5D97A;
  --hit-current: #E8A317;
  --hit-ink: #241C05;
  --scrim: rgba(28, 22, 14, .38);
  --sh-1: 0 1px 2px rgba(26, 22, 14, .07);
  --sh-2: 0 2px 8px rgba(26, 22, 14, .10);
  --sh-3: 0 12px 40px rgba(26, 22, 14, .22);
}

:root[data-theme='dark'] {
  --paper: #17161A;
  --paper-raised: #201E24;
  --paper-sunken: #121115;
  --table: #0E0D10;
  --rule: #302D36;
  --rule-strong: #423E4A;
  --ink: #EDEAE4;
  --ink-muted: #9A948C;
  --ink-faint: #6B6670;
  --accent: #C4595A;
  --accent-hover: #D46B6C;
  --accent-ink: #1A1012;
  --accent-wash: #2A1C1E;
  --danger: #E0736A;
  --ok: #5FBF7E;
  --warn-wash: #3B3116;
  --warn-ink: #E7C877;
  --hit: #6E5A1E;
  --hit-current: #B98A17;
  --hit-ink: #F7EFD8;
  --scrim: rgba(0, 0, 0, .58);
  --sh-1: 0 1px 2px rgba(0, 0, 0, .5);
  --sh-2: 0 2px 8px rgba(0, 0, 0, .55);
  --sh-3: 0 12px 40px rgba(0, 0, 0, .7);
}

@media (prefers-reduced-motion: reduce) {
  :root { --motion: 0; }
}
`;
