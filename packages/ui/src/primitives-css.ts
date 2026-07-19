/**
 * Styles des primitives, en chaîne CSS pour la même raison que `tokensCss` :
 * le lecteur mobile exporté inline son style, il ne peut pas importer de `.css`.
 *
 * Tout est exprimé en jetons — aucune valeur en dur ici, sinon le thème sombre
 * et le passage aux cibles tactiles cessent de fonctionner.
 */

export const primitivesCss = `
/* ── Boutons ───────────────────────────────────────────────────────────────── */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2);
  height: var(--ctl-h);
  padding: 0 var(--sp-3);
  font: inherit;
  font-family: var(--font-ui);
  font-size: var(--fs-md);
  line-height: 1;
  color: var(--ink);
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: var(--r-md);
  cursor: pointer;
  white-space: nowrap;
  -webkit-tap-highlight-color: transparent;
}
.btn:hover:not(:disabled) { background: var(--paper-sunken); }
.btn:active:not(:disabled) { transform: translateY(.5px); }
.btn:disabled { opacity: .45; cursor: default; }
.btn:focus-visible { outline: none; box-shadow: var(--focus-ring); }

.btn--sm { height: calc(var(--ctl-h) - 4px); padding: 0 var(--sp-2); font-size: var(--fs-sm); }
.btn--touch { height: var(--ctl-h-touch); min-width: var(--ctl-h-touch); padding: 0 var(--sp-4); font-size: var(--fs-lg); }
/* Rond, pour se distinguer au premier coup d'œil des cibles rectangulaires
   qui l'entourent — la forme porte la hiérarchie autant que l'accent. */
.btn--hero {
  height: var(--ctl-h-hero);
  min-width: var(--ctl-h-hero);
  padding: 0 var(--sp-4);
  font-size: var(--fs-lg);
  border-radius: var(--r-full);
}

.btn--icon { padding: 0; width: var(--ctl-h); }
.btn--icon.btn--sm { width: calc(var(--ctl-h) - 4px); }
.btn--icon.btn--touch { width: var(--ctl-h-touch); padding: 0; }
.btn--icon.btn--hero { width: var(--ctl-h-hero); padding: 0; }

/* L'aplat accent est réservé à l'action primaire unique de l'écran. */
.btn--primary {
  color: var(--accent-ink);
  background: var(--accent);
  border-color: var(--accent);
}
.btn--primary:hover:not(:disabled) { background: var(--accent-hover); border-color: var(--accent-hover); }

.btn--ghost { background: transparent; border-color: transparent; color: var(--ink-muted); }
.btn--ghost:hover:not(:disabled) { background: var(--paper-sunken); color: var(--ink); }

/* Destructif : jamais d'aplat — la couleur seule ne suffit pas à distinguer du
   rouge d'accent, c'est la forme qui porte le sens. */
.btn--danger { color: var(--danger); background: transparent; border-color: transparent; }
.btn--danger:hover:not(:disabled) { background: var(--paper-sunken); }

/* État actif (mode répétition, panneau ouvert, onglet courant) : « en scène ». */
.btn[aria-pressed='true'] {
  color: var(--accent);
  background: var(--accent-wash);
  border-color: var(--accent);
}

/* ── Barres d'outils ───────────────────────────────────────────────────────── */
.toolbar {
  display: flex;
  align-items: center;
  gap: var(--sp-4);
  padding: var(--sp-2) var(--sp-4);
  background: var(--paper);
  color: var(--ink);
  font-family: var(--font-ui);
  font-size: var(--fs-md);
}
/* Un groupe ne se casse jamais : c'est l'unité de mise en page de la barre. */
.toolbar-group {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  flex: 0 0 auto;
  min-width: 0;
}
.toolbar-group--grow { flex: 1 1 auto; }
.toolbar-spacer { flex: 1 1 auto; }
.toolbar-sep { width: 1px; align-self: stretch; margin: var(--sp-1) 0; background: var(--rule); }

/* ── Sheet ─────────────────────────────────────────────────────────────────── */
.sheet-backdrop {
  position: fixed;
  inset: 0;
  z-index: 30;
  background: rgba(12, 10, 8, .38);
  opacity: 0;
  pointer-events: none;
  transition: opacity .18s ease;
}
.sheet-backdrop.is-open { opacity: 1; pointer-events: auto; }

.sheet {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 31;
  display: flex;
  flex-direction: column;
  max-height: min(76vh, 640px);
  background: var(--paper);
  color: var(--ink);
  font-family: var(--font-ui);
  border-top: 1px solid var(--rule);
  border-radius: var(--r-lg) var(--r-lg) 0 0;
  box-shadow: var(--sh-3);
  transform: translateY(101%);
  padding-bottom: env(safe-area-inset-bottom);
  /* Masquée par visibility et non par display : une sheet fermée doit rester
     dans le flux pour que sa transition joue. Le délai la masque seulement UNE
     FOIS la glissade terminée — sans lui, la fermeture serait un escamotage sec ;
     et sans masquage du tout, l'ombre portée (--sh-3) assombrirait le bas de
     l'écran en permanence. */
  visibility: hidden;
  transition: transform .22s cubic-bezier(.3, .8, .4, 1), visibility 0s linear .22s;
}
.sheet.is-open {
  transform: translateY(0);
  visibility: visible;
  transition: transform .22s cubic-bezier(.3, .8, .4, 1), visibility 0s;
}

.sheet-head {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-3) var(--sp-3) var(--sp-3) var(--sp-5);
  border-bottom: 1px solid var(--rule);
}
/* Marge négative plutôt qu'un padding conditionnel : le retour vient se loger
   dans la gouttière du titre, et une sheet sans retour garde exactement la
   même position de titre qu'avant. */
.sheet-back { margin-left: calc(-1 * var(--sp-4)); }
.sheet-title {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-sm);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: var(--tracking-label);
  color: var(--ink-muted);
}
.sheet-body { overflow-y: auto; padding: var(--sp-3) var(--sp-5) var(--sp-5); }

@media (prefers-reduced-motion: reduce) {
  .sheet, .sheet-backdrop { transition: none; }
}
`;
