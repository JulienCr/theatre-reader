/**
 * Rendu d'une pièce (AST) selon un template, en HTML + CSS.
 *
 * Le même rendu sert à la preview web (fragment via `renderBody`) et à l'export
 * PDF (document complet via `renderDocument`, ouvert par Playwright). Les
 * couleurs de surlignage sont injectées en style inline (dynamiques par
 * personnage), tout le reste est piloté par la feuille CSS du template.
 */

import { LineNode, Node, Play } from './ast';
import { buildNodeIds } from './notes';
import { HeadingStyle, Highlight, Template } from './template';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function highlightFor(
  template: Template,
  characterId: string,
): Highlight | undefined {
  return template.highlights.find((h) => h.characterId === characterId);
}

function renderLine(node: LineNode, play: Play, template: Template, nodeId: string): string {
  const character = play.characters.find((c) => c.id === node.characterId);
  const name = character?.canonicalName ?? node.characterId;
  const hl = highlightFor(template, node.characterId);

  const cueBg = hl && hl.scope === 'name' ? hl.color : undefined;
  const lineBg = hl && hl.scope === 'replique' ? hl.color : undefined;

  const cue = `<span class="cue"${cueBg ? ` style="background-color:${cueBg}"` : ''}>${escapeHtml(name)}</span>`;
  const sep = template.characterName.sameLineAsDialogue
    ? `<span class="cue-sep">${escapeHtml(template.characterName.suffix)}</span>`
    : '<br/>';

  const body = node.segments
    .map((seg) => {
      if (seg.type === 'speech') {
        return `<span class="speech">${escapeHtml(seg.text)}</span>`;
      }
      if (template.inlineStageDirection.hidden) return '';
      return `<span class="didascalie-inline">(${escapeHtml(seg.text)})</span>`;
    })
    .filter(Boolean)
    .join(' ');

  const flagged = node.flagged ? ' line--flagged' : '';
  const styleAttr = lineBg ? ` style="background-color:${lineBg}"` : '';
  return `<p class="line${flagged}" data-cid="${escapeHtml(node.characterId)}" data-nid="${nodeId}"${styleAttr}>${cue}${sep}${body}</p>`;
}

function renderNode(node: Node, play: Play, template: Template, nodeId: string): string {
  switch (node.type) {
    case 'act':
      return `<h2 class="act">${escapeHtml(node.label)}</h2>`;
    case 'scene':
      return `<h3 class="scene">${escapeHtml(node.label)}</h3>`;
    case 'stage': {
      if (template.stageDirection.hidden) return '';
      const flagged = node.flagged ? ' stage--flagged' : '';
      return `<p class="stage${flagged}" data-nid="${nodeId}">${escapeHtml(node.text)}</p>`;
    }
    case 'line':
      return renderLine(node, play, template, nodeId);
  }
}

/** Section de présentation des personnages (DISTRIBUTION), depuis les descriptions. */
function renderDistribution(play: Play, template: Template): string {
  // `!== false` : les templates sauvegardés avant cette option l'affichent aussi.
  if (template.showDistribution === false) return '';
  const presented = play.characters.filter((c) => c.description && c.description.trim());
  if (!presented.length) return '';
  const entries = presented
    .map(
      (c) =>
        `<p class="dist-entry"><span class="dist-name">${escapeHtml(c.canonicalName)}</span> : ` +
        `<span class="dist-desc">${escapeHtml(c.description!.trim())}</span></p>`,
    )
    .join('');
  const breakClass = template.distributionPageBreak !== false ? ' distribution--break' : '';
  return `<section class="distribution${breakClass}"><h2 class="dist-heading">Distribution</h2>${entries}</section>`;
}

/** Une entrée de sommaire / navigation (acte ou scène). */
export interface TocEntry {
  /** id de l'en-tête correspondant dans le rendu (`h-<index de nœud>`). */
  id: string;
  label: string;
  scene: boolean;
  nodeIndex: number;
}

/**
 * Construit la table des actes/scènes : source unique des en-têtes (id, libellé,
 * masquage d'acte en mode `showAct`), réutilisée par `renderBody`, le sommaire et
 * le mode lecteur — pour garantir des `id` cohérents.
 */
export function buildToc(play: Play, template: Template): TocEntry[] {
  const entries: TocEntry[] = [];
  let currentAct = '';
  const nodes = play.nodes;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    if (node.type === 'act') {
      currentAct = node.label;
      // En mode « acte avec chaque scène », l'en-tête d'acte autonome est
      // redondant lorsqu'il précède immédiatement une scène — on le masque.
      const next = nodes[i + 1];
      if (template.sceneHeading.showAct && next?.type === 'scene') continue;
      entries.push({ id: `h-${i}`, label: node.label, scene: false, nodeIndex: i });
    } else if (node.type === 'scene') {
      const label =
        template.sceneHeading.showAct && currentAct
          ? `${currentAct} ${node.label}`
          : node.label;
      entries.push({ id: `h-${i}`, label, scene: true, nodeIndex: i });
    }
  }
  return entries;
}

/**
 * Fragment HTML du corps de la pièce (sans <html>/<head>).
 *
 * `nodeIds` permet d'imposer les `data-nid` au lieu de les recalculer : le lecteur
 * web, en mode « mes scènes », rend une pièce FILTRÉE mais veut garder les ids de la
 * pièce COMPLÈTE (sinon `buildNodeIds` renumérote les nœuds au contenu identique et
 * les notes, ancrées sur l'id complet, deviennent orphelines ou se déplacent). Il
 * passe donc les ids d'origine des nœuds survivants ; par défaut on les calcule.
 */
export function renderBody(play: Play, template: Template, nodeIds: string[] = buildNodeIds(play)): string {
  const header: string[] = [];
  if (play.title) header.push(`<h1 class="title">${escapeHtml(play.title)}</h1>`);
  if (play.author) header.push(`<div class="author">de ${escapeHtml(play.author)}</div>`);
  const headerHtml = header.length ? `<header class="play-header">${header.join('')}</header>` : '';
  const distributionHtml = renderDistribution(play, template);

  const entries = buildToc(play, template);
  const byIndex = new Map(entries.map((e) => [e.nodeIndex, e]));

  const out: string[] = [];
  const nodes = play.nodes;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    const entry = byIndex.get(i);
    const nid = nodeIds[i]!;
    if (node.type === 'act') {
      if (!entry) continue; // acte masqué (suivi d'une scène en mode showAct)
      out.push(`<h2 class="act" id="${entry.id}" data-nid="${nid}">${escapeHtml(node.label)}</h2>`);
    } else if (node.type === 'scene') {
      out.push(`<h3 class="scene" id="${entry!.id}" data-nid="${nid}">${escapeHtml(entry!.label)}</h3>`);
    } else {
      out.push(renderNode(node, play, template, nid));
    }
  }

  const tocHtml = renderToc(entries, template);
  return `<article class="play">${headerHtml}${distributionHtml}${tocHtml}${out.join('\n')}</article>`;
}

/**
 * Sommaire (actes/scènes). Les numéros de page sont injectés par le moteur de
 * pagination (Paged.js) via `target-counter` ; à l'écran en flux continu, seuls
 * les intitulés s'affichent.
 */
function renderToc(entries: TocEntry[], template: Template): string {
  if (template.showToc === false || !entries.length) return '';
  // En mode « acte avec chaque scène », chaque ligne porte déjà son acte :
  // pas d'en-tête d'acte parent → sommaire à plat (sans indentation des scènes).
  const flat = template.sceneHeading.showAct ? ' toc--flat' : '';
  const items = entries
    .map(
      (e) =>
        `<li class="toc-item ${e.scene ? 'toc-item--scene' : 'toc-item--act'}">` +
        `<a href="#${e.id}"><span class="toc-title">${escapeHtml(e.label)}</span></a></li>`,
    )
    .join('');
  return `<nav class="toc${flat}"><h2 class="toc-heading">Sommaire</h2><ul class="toc-list">${items}</ul></nav>`;
}

const PAGE_SIZE: Record<Template['page']['format'], string> = {
  A4: '210mm 297mm',
  Letter: '8.5in 11in',
};

/** CSS d'un en-tête (acte/scène) : style + fond/encadré qui épouse le texte. */
function headingRules(selector: string, s: HeadingStyle, mTop: string, mBottom: string): string {
  const decl: string[] = [
    `font-weight: ${s.bold ? 'bold' : 'normal'}`,
    `text-transform: ${s.caps ? 'uppercase' : 'none'}`,
  ];
  if (s.color) decl.push(`color: ${s.color}`);
  if (s.fontSizeEm) decl.push(`font-size: ${s.fontSizeEm}em`);

  const boxed = Boolean(s.background || s.border);
  if (s.background) decl.push(`background: ${s.background}`);
  if (s.border) decl.push(`border: 1.5px solid ${s.borderColor ?? 'currentColor'}`);

  if (boxed) {
    // Le cadre épouse le texte ; l'alignement se fait via les marges auto.
    decl.push('display: table', 'padding: .2em .6em', 'border-radius: 5px');
    const ml = s.align === 'center' || s.align === 'right' ? 'auto' : '0';
    const mr = s.align === 'center' || s.align === 'left' ? 'auto' : '0';
    decl.push(`margin: ${mTop} ${mr} ${mBottom} ${ml}`);
  } else {
    decl.push(`text-align: ${s.align}`, `margin: ${mTop} 0 ${mBottom}`);
  }
  return `${selector} { ${decl.join('; ')}; }`;
}

/** Feuille de style dérivée du template. */
export function renderCSS(template: Template): string {
  const p = template.page;
  const name = template.characterName;
  const stage = template.stageDirection;
  const inline = template.inlineStageDirection;

  return `
.play {
  font-family: ${p.fontFamily};
  font-size: ${p.fontSizePt}pt;
  line-height: ${p.lineHeight};
  color: #111;
}
.play-header { text-align: center; margin-bottom: 2em; }
.title { font-size: 1.5em; font-weight: bold; margin: 0 0 .3em; }
.author { font-style: italic; }
.distribution { margin-bottom: 1.8em; }
.distribution--break { break-after: page; }
@media screen {
  .distribution--break {
    border-bottom: 2px dashed #cdd2da;
    padding-bottom: 1.4em;
    margin-bottom: 2.4em;
  }
}
.dist-heading {
  font-weight: bold;
  text-decoration: underline;
  margin: 0 0 .6em;
}
.dist-entry { margin: 0 0 .4em; }
.dist-name { font-weight: bold; text-decoration: underline; }
.toc { break-after: page; }
@media screen {
  .toc { border-bottom: 2px dashed #cdd2da; padding-bottom: 1.4em; margin-bottom: 2.4em; }
}
.toc-heading { font-weight: bold; text-decoration: underline; margin: 0 0 .6em; }
.toc-list { list-style: none; margin: 0; padding: 0; }
.toc-item { margin: .15em 0; }
.toc-item--scene { margin-left: 1.6em; }
.toc--flat .toc-item--scene { margin-left: 0; }
.toc-item a {
  display: flex;
  align-items: baseline;
  text-decoration: none;
  color: inherit;
  gap: .5em;
}
.toc-item--act a { font-weight: bold; }
.toc-title { flex: 0 1 auto; }
/* Numéro de page (résolu par Paged.js à l'export) poussé à droite, avec ligne de conduite. */
.toc-item a::after {
  content: target-counter(attr(href), page);
  margin-left: auto;
  padding-left: .5em;
}
${headingRules('.act', template.actHeading, '1.6em', '.8em')}
${headingRules('.scene', template.sceneHeading, '1.2em', '.6em')}
.line { margin: 0 0 .5em; }
.cue {
  font-weight: ${name.bold ? 'bold' : 'normal'};
  font-style: ${name.italic ? 'italic' : 'normal'};
  text-transform: ${name.caps ? 'uppercase' : 'none'};
  ${name.color ? `color: ${name.color};` : ''}
}
.cue-sep { white-space: pre; }
${template.speechColor ? `.speech { color: ${template.speechColor}; }` : ''}
.didascalie-inline {
  font-style: ${inline.italic ? 'italic' : 'normal'};
  ${inline.color ? `color: ${inline.color};` : ''}
}
.stage {
  font-style: ${stage.italic ? 'italic' : 'normal'};
  ${stage.color ? `color: ${stage.color};` : ''}
  ${stage.indent ? 'margin-left: 2em;' : ''}
  margin-top: .6em; margin-bottom: .6em;
}
.line--flagged, .stage--flagged {
  outline: 1px dashed #e0a800;
  outline-offset: 2px;
}
@page {
  size: ${PAGE_SIZE[p.format]};
  margin: ${p.marginMm}mm;
${
  template.pageNumbers === false
    ? ''
    : `  @bottom-center {
    content: "page " counter(page) " / " counter(pages);
    font-family: ${p.fontFamily};
    font-size: 9pt;
    color: #888;
  }`
}
}
`.trim();
}

/** Document HTML complet (pour export PDF via Playwright). */
export function renderDocument(play: Play, template: Template): string {
  const css = renderCSS(template);
  const body = renderBody(play, template);
  const title = play.title ? escapeHtml(play.title) : 'Pièce';
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8"/>
<title>${title}</title>
<style>
* { box-sizing: border-box; }
/* La mise en page (marges, pages) est gérée par Paged.js via @page. */
body { margin: 0; padding: 0; }
${css}
</style>
</head>
<body>${body}</body>
</html>`;
}
