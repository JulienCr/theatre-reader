/**
 * Feuille de style du chrome mobile, inlinée dans le .html exporté.
 *
 * Jetons + primitives de @theatre/ui et composants de chrome de
 * @theatre/reader-ui : le lecteur mobile et l'app web partagent exactement le
 * même CSS de base. Il ne reste ici que ce qui est propre au mobile —
 * l'agencement de la barre, l'intérieur des sheets, et les classes posées sur
 * `.play` par le moteur audio. esbuild inline la chaîne au bundle, le .html
 * reste autonome.
 */
import { readerChromeCss } from '@theatre/reader-ui';
import { uiCss } from '@theatre/ui';

export const STYLE =
  uiCss +
  readerChromeCss +
  `
/* ── Dock du bas : bandeau de contexte + barre ─────────────────────────────── */
.reader-dock {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 10;
  background: var(--paper); border-top: 1px solid var(--rule);
  box-shadow: 0 -2px 12px rgba(0,0,0,.06);
  padding-bottom: max(var(--sp-3), env(safe-area-inset-bottom));
}
.reader-bar { gap: var(--sp-2); padding: var(--sp-2) var(--sp-3) 0; background: transparent; }
/* Les deux zones latérales ont la même souplesse : la zone du milieu est donc
   centrée sans qu'on ait à la mesurer. flex-basis à 0 et non auto, sinon la
   largeur du contenu (menu à gauche, bascule à droite) décalerait le centre. */
.reader-bar-side, .reader-bar .transport-mode { flex: 1 1 0; }
.reader-bar > .reader-bar-side:last-child, .reader-bar .transport-mode { justify-content: flex-end; }
/* Les cibles restent à 44 px, mais sans la générosité horizontale du bouton
   tactile par défaut : à 320 px, 14 px de marge de chaque côté suffisaient à
   pousser la bascule hors de la barre. */
.reader-bar .btn--touch { padding: 0 var(--sp-3); }

/* ── Sheets ───────────────────────────────────────────────────────────────── */
.sheet-nav { margin: 0 calc(var(--sp-5) * -1) var(--sp-3); }
.sheet-nav-item {
  display: flex; align-items: center; gap: var(--sp-3); width: 100%;
  min-height: var(--ctl-h-touch); padding: 12px var(--sp-5);
  font: inherit; font-size: 16px; text-align: left; color: var(--ink);
  background: transparent; border: 0; border-bottom: 1px solid var(--rule);
  cursor: pointer; -webkit-tap-highlight-color: transparent;
}
.sheet-nav-item:active { background: var(--paper-sunken); }
.sheet-nav-label { flex: 1 1 auto; }
.sheet-nav-hint { color: var(--ink-muted); font-size: var(--fs-lg); }
.sheet-nav-chevron { color: var(--ink-faint); flex: 0 0 auto; }

.sheet-field { padding: var(--sp-3) 0 0; }
.sheet-field-head { display: flex; align-items: center; justify-content: space-between; font-size: 16px; }
.sheet-field-label { display: inline-flex; align-items: center; gap: var(--sp-2); }
.sheet-field-value { color: var(--ink-muted); font-variant-numeric: tabular-nums; }
.sheet-slider { width: 100%; height: var(--ctl-h-touch); margin: 0; accent-color: var(--accent); }

.sheet-body .row { display: block; padding: 12px 6px; border-bottom: 1px solid var(--rule); font-size: 16px; }
/* Sans accent-color, la case cochée est le bleu du navigateur — hors palette. */
.sheet-body .row input { margin-right: 10px; transform: scale(1.3); accent-color: var(--accent); }
.sheet-body .row input:disabled { opacity: .4; }
.sheet-body .swatch { display: inline-block; width: 14px; height: 14px; border-radius: 3px; margin-left: 8px; vertical-align: middle; }
.sheet-body .scene-link { display: block; color: inherit; text-decoration: none; }
.sheet-body .scene-link.is-scene { padding-left: 18px; }
.sheet-body .mode-hint { display: block; font-size: var(--fs-md); color: var(--ink-muted); margin: 4px 0 0 30px; }
.sheet-body .mode-subhead { font-weight: 600; margin: var(--sp-5) 0 var(--sp-2); }

.reader-search { display: flex; gap: var(--sp-2); margin-bottom: var(--sp-4); }
/* 16 px minimum : en deçà, iOS zoome sur le champ à la prise de focus. */
.reader-search input { flex: 1; min-width: 0; font: inherit; font-size: 16px; padding: 10px; border: 1px solid var(--rule); border-radius: var(--r-md); background: var(--paper-raised); color: var(--ink); }
.reader-search input:focus-visible { outline: none; box-shadow: var(--focus-ring); }
.reader-search-prev svg { transform: rotate(180deg); }

/* Segmenté : deux boutons partagés à parts égales, l'état actif venant de la
   primitive (aria-pressed) — rien à redéfinir ici. */
.mode-seg { display: flex; gap: var(--sp-2); margin-bottom: var(--sp-4); }
.mode-seg .btn { flex: 1; }

/* ── Classes posées sur .play par le moteur audio et la recherche ───────── */
.line--masked .speech { display: inline-block; filter: blur(5px); transition: filter .12s; cursor: pointer; }
.line--masked.line--revealed .speech { filter: none; }
.line-timer { display: block; height: 4px; margin: 0 0 6px; border-radius: 2px; background: color-mix(in srgb, var(--ink) 12%, transparent); overflow: hidden; }
.line-timer-fill { display: block; height: 100%; width: 0; background: var(--accent); border-radius: 2px; }
mark.reader-hit { background: var(--hit); color: var(--hit-ink); }
mark.reader-hit--current { background: var(--hit-current); }
/* Contour en encre sourde et non en accent : la réplique en cours est un repère
   permanent (il sert aussi en lecture continue), alors que l'accent signale ce
   qui réclame une action — le bouton Lecture, la bascule Répétition active et le
   « à toi » du bandeau. Trois rouges pour un seul et même état, c'était un de trop. */
.line--speaking { outline: 2px solid var(--ink-muted); outline-offset: 3px; border-radius: 4px; scroll-margin: 40vh; }
/* Réserve la hauteur du dock (bandeau + barre) : la dernière réplique doit
   rester atteignable. */
.play { padding-bottom: calc(120px + env(safe-area-inset-bottom)); }
`;
