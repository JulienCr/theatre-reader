/**
 * Styles des composants de chrome du lecteur, en chaîne CSS pour la même raison
 * que `uiCss` : le lecteur mobile exporté inline son style, il ne peut pas
 * importer de `.css`. À concaténer après `uiCss`.
 *
 * Uniquement l'intérieur des composants : leur placement dans une barre (centré,
 * poussé au bord) appartient à la surface qui les compose.
 */

export const readerChromeCss = `
/* ── Dock de transport ─────────────────────────────────────────────────────── */
.transport-play { box-shadow: var(--sh-2); }

/* ── Bandeau de contexte ───────────────────────────────────────────────────── */
.ctx-banner {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: var(--sp-2);
  min-width: 0;
  padding: var(--sp-1) var(--sp-4) 0;
  font-family: var(--font-ui);
  font-size: var(--fs-sm);
  letter-spacing: var(--tracking-label);
  color: var(--ink-muted);
}
.ctx-banner-scene {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* « à toi » est l'état « en scène » du lecteur : accent, mais en texte seul —
   l'aplat reste réservé au bouton Lecture (cf. tokens.ts). */
.ctx-banner-cue {
  flex: 0 0 auto;
  color: var(--accent);
  font-weight: 600;
}
.ctx-banner-scene + .ctx-banner-cue::before {
  content: '—';
  margin-right: var(--sp-2);
  color: var(--ink-faint);
  font-weight: 400;
}
`;
