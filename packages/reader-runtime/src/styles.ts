/**
 * Feuille de style du chrome mobile, inlinée dans le .html exporté.
 *
 * Jetons + primitives de @theatre/ui : le lecteur mobile et l'app web partagent
 * exactement le même CSS de base (cf. packages/ui/src/index.ts). esbuild inline
 * la chaîne au bundle, le .html reste autonome.
 */
import { uiCss } from '@theatre/ui';

export const STYLE =
  uiCss +
  `
.reader-bar {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 10;
  display: flex; gap: var(--sp-2); padding: var(--sp-3); justify-content: center;
  background: var(--paper); border-top: 1px solid var(--rule);
  box-shadow: 0 -2px 12px rgba(0,0,0,.06);
  padding-bottom: max(var(--sp-3), env(safe-area-inset-bottom));
}
.reader-bar button {
  font: inherit; font-size: var(--fs-lg); padding: 10px 12px; min-width: var(--ctl-h-touch);
  border: 1px solid var(--rule); border-radius: var(--r-md); background: var(--paper-raised);
  color: var(--ink);
}
.reader-bar button[aria-pressed="true"] { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
.reader-sheet {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 20;
  max-height: 70vh; overflow: auto; padding: var(--sp-5) var(--sp-5) var(--sp-6);
  background: var(--paper); color: var(--ink);
  border-top-left-radius: var(--r-lg); border-top-right-radius: var(--r-lg);
  box-shadow: var(--sh-3); transform: translateY(110%);
  transition: transform .2s ease;
  padding-bottom: max(var(--sp-6), env(safe-area-inset-bottom));
}
.reader-sheet.open { transform: translateY(0); }
.reader-sheet h2 { margin: 0 0 var(--sp-4); font-size: 17px; }
.reader-sheet .row { display: block; padding: 12px 6px; border-bottom: 1px solid var(--rule); font-size: 16px; }
.reader-sheet .row input { margin-right: 10px; transform: scale(1.3); }
.reader-sheet .swatch { display: inline-block; width: 14px; height: 14px; border-radius: 3px; margin-left: 8px; vertical-align: middle; }
.reader-sheet .scene-link { color: inherit; text-decoration: none; }
.reader-sheet .scene-link.is-scene { padding-left: 18px; }
.reader-search { display: flex; gap: var(--sp-2); margin-bottom: var(--sp-4); }
.reader-search input { flex: 1; font: inherit; font-size: 16px; padding: 10px; border: 1px solid var(--rule); border-radius: var(--r-md); background: var(--paper-raised); color: var(--ink); }
.reader-backdrop { position: fixed; inset: 0; z-index: 15; background: var(--scrim); display: none; }
.reader-backdrop.open { display: block; }
.line--masked .speech { display: inline-block; filter: blur(5px); transition: filter .12s; cursor: pointer; }
.line--masked.line--revealed .speech { filter: none; }
.line-timer { display: block; height: 4px; margin: 0 0 6px; border-radius: 2px; background: color-mix(in srgb, var(--ink) 12%, transparent); overflow: hidden; }
.line-timer-fill { display: block; height: 100%; width: 0; background: var(--accent); border-radius: 2px; }
.reader-sheet .mode-hint { display: block; font-size: var(--fs-md); color: var(--ink-muted); margin: 4px 0 0 30px; }
.reader-sheet .mode-subhead { font-weight: 600; margin: var(--sp-5) 0 var(--sp-2); }
.reader-sheet .row input:disabled { opacity: .4; }
.mode-seg { display: flex; gap: var(--sp-2); margin-bottom: var(--sp-4); }
.mode-seg button { flex: 1; font: inherit; font-size: var(--fs-lg); padding: 10px; border: 1px solid var(--rule); border-radius: var(--r-md); background: var(--paper-raised); color: var(--ink); }
.mode-seg button[aria-pressed="true"] { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
mark.reader-hit { background: var(--hit); color: var(--hit-ink); }
mark.reader-hit--current { background: var(--hit-current); }
.line--speaking { outline: 2px solid var(--accent); outline-offset: 3px; border-radius: 4px; scroll-margin: 40vh; }
.play { padding-bottom: calc(96px + env(safe-area-inset-bottom)); }
`;
