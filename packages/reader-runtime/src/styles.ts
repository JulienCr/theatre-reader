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
  box-shadow: var(--sh-up);
  padding-bottom: max(var(--sp-3), env(safe-area-inset-bottom));
}
/* Padding horizontal à --sp-2 et non --sp-3 : à sept contrôles, les 8 px gagnés sont
   ce qui fait tenir la barre sur un écran de 375 px (368 px de contenu mesurés). */
.reader-bar { gap: var(--sp-2); padding: var(--sp-2) var(--sp-2) 0; background: transparent; }
/* Les deux zones latérales ont la même souplesse : la zone du milieu est donc
   centrée sans qu'on ait à la mesurer. flex-basis à 0 et non auto, sinon la
   largeur du contenu (menu à gauche, bascule à droite) décalerait le centre. */
/* Le min-width annule celui de la primitive (0) : une base à 0 laisse sinon le groupe
   devenir plus étroit que son contenu, et les boutons se CHEVAUCHENT au lieu de
   déborder. Mesuré à 320 px : deux paires superposées, chacune rendant l'autre
   incliquable. Sans effet aux largeurs où tout tient — la base reste 0, donc le
   centrage ne dépend toujours pas du contenu. */
.reader-bar-side, .reader-bar .transport-mode { flex: 1 1 0; min-width: min-content; }
.reader-bar > .reader-bar-side:last-child, .reader-bar .transport-mode { justify-content: flex-end; }
/* Les cibles restent à 44 px, mais sans la générosité horizontale du bouton
   tactile par défaut : à 320 px, 14 px de marge de chaque côté suffisaient à
   pousser la bascule hors de la barre. */
.reader-bar .btn--touch { padding: 0 var(--sp-3); }
/* Une cible tactile ne se négocie pas : sous la largeur nécessaire, la barre déborde
   (ça se voit) plutôt que de rétrécir ses boutons (ça ne se voit pas, et le doigt les
   rate). Mesuré sans ce garde : 20 px de large à 320 px d'écran. */
.reader-bar .btn { flex: 0 0 auto; }
/* « 1,5× » tient largement dans une cible carrée : la ramener à 44 px la fait
   compter comme une icône dans le budget de largeur de la barre. */
.reader-bar .btn--rate {
  width: var(--ctl-h-touch); min-width: 0; padding: 0;
  font-size: var(--fs-md); font-variant-numeric: tabular-nums;
}

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

/* Ligne d'explication en tête d'une sheet, avant la première rangée. */
.sheet-intro { margin: 0 0 var(--sp-3); color: var(--ink-muted); font-size: var(--fs-lg); }

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

.reader-search { display: flex; gap: var(--sp-2); margin-bottom: var(--sp-4); }
/* 16 px minimum : en deçà, iOS zoome sur le champ à la prise de focus. */
.reader-search input { flex: 1; min-width: 0; font: inherit; font-size: 16px; padding: 10px; border: 1px solid var(--rule); border-radius: var(--r-md); background: var(--paper-raised); color: var(--ink); }
.reader-search input:focus-visible { outline: none; box-shadow: var(--focus-ring); }
.reader-search-prev svg { transform: rotate(180deg); }

/* Segmenté : deux boutons partagés à parts égales, l'état actif venant de la
   primitive (aria-pressed) — rien à redéfinir ici. */
.mode-seg { display: flex; gap: var(--sp-2); margin-bottom: var(--sp-4); }
.mode-seg .btn { flex: 1; }
/* Sous-segment (Souple/Strict) : décalé sous sa case pour se lire comme un détail
   de l'option cochée juste au-dessus, et non comme un troisième mode de lecture. */
.mode-seg--sub { margin: var(--sp-2) 0 var(--sp-4) 30px; }

/* ── Répétition vocale : retour au-dessus de la barre ──────────────────────── */
.voice-panel {
  padding: var(--sp-2) var(--sp-3) 0;
  /* La tirade attendue peut faire plusieurs lignes : on borne, sinon le panneau
     mange l'écran au moment précis où on veut relire le texte au-dessus. */
  max-height: 28vh; overflow-y: auto;
}
.voice-head { display: flex; align-items: baseline; gap: var(--sp-2); }
.voice-state {
  font-size: var(--fs-md); font-variant: small-caps; letter-spacing: .04em;
  color: var(--ink-muted); white-space: nowrap;
}
/* L'écoute et la réécoute du modèle sont les deux moments où l'on attend quelque
   chose de la personne : ce sont les seuls à porter la couleur d'accent. */
.voice-panel[data-phase="listening"] .voice-state,
.voice-panel[data-phase="reference"] .voice-state { color: var(--accent); }
.voice-panel[data-phase="failed"] .voice-state { color: var(--danger); }
.voice-panel[data-phase="validated"] .voice-state { color: var(--ok); }
/* Transcription en cours : présente mais discrète — la lire n'est pas le but,
   elle ne sert qu'à comprendre pourquoi le verdict tombe comme il tombe. */
.voice-heard {
  flex: 1; min-width: 0; font-size: var(--fs-md); color: var(--ink-muted);
  font-style: italic; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.voice-message { margin: 4px 0 0; font-size: var(--fs-md); color: var(--ink-muted); }
.voice-diff { margin: var(--sp-2) 0 0; font-size: var(--fs-md); line-height: 1.6; }
.voice-word--ok { color: var(--ink-muted); }
/* Barré et non effacé : voir le mot manquant à sa place est ce qui apprend le texte. */
.voice-word--missing { color: var(--danger); text-decoration: line-through; }
.voice-word--replaced { color: var(--danger); }
.voice-word--added {
  color: var(--warn-ink); background: var(--warn-wash);
  border-radius: var(--r-sm); padding: 0 .25em;
}

/* ── Classes posées sur .play par le moteur audio et la recherche ───────── */
/* Option « mes scènes » : les plages exclues sont retirées du flux ; !important
   pour l'emporter sur le display propre aux répliques/en-têtes. */
.scene--hidden { display: none !important; }
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
/* La page occupe l'écran entier — dans l'app iOS, la WebView n'ajoute aucun inset
   (contentInset: 'never', capacitor.config.ts) — donc les deux bords se réservent
   ici : la barre d'état en haut, le dock (bandeau + barre) et l'indicateur
   d'accueil en bas. Sans quoi la première réplique démarre sous l'heure et la
   dernière reste sous le dock. Hors app, env() vaut 0 et il ne reste que l'air
   de --sp-3. */
.play {
  padding-top: max(var(--sp-3), env(safe-area-inset-top));
  padding-bottom: calc(120px + env(safe-area-inset-bottom));
}
`;
