/**
 * Extraction du texte d'un PDF avec reconstruction des lignes/paragraphes et
 * détection (best-effort) de l'italique — signal utile pour repérer les
 * didascalies, mais non indispensable (cf. heuristics.ts qui sait s'en passer).
 *
 * Utilise pdfjs-dist (build legacy, exécution Node sans worker).
 */

import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

export interface ExtractedLine {
  page: number;
  /** x du bord gauche (coordonnées PDF). */
  x: number;
  /** y de la ligne de base (coordonnées PDF, croît vers le haut). */
  y: number;
  text: string;
  /** Majorité de caractères en italique sur la ligne. */
  italic: boolean;
  /** true si un saut de paragraphe suit cette ligne. */
  paragraphBreak: boolean;
}

export interface ExtractedDoc {
  numPages: number;
  lines: ExtractedLine[];
}

interface RawItem {
  str: string;
  x: number;
  y: number;
  width: number;
  italic: boolean;
}

function detectItalic(
  fontName: string,
  styles: Record<string, { fontFamily?: string }> | undefined,
  page: { commonObjs: { has(k: string): boolean; get(k: string): unknown } },
): boolean {
  const fam = styles?.[fontName]?.fontFamily;
  if (fam && /italic|oblique/i.test(fam)) return true;
  try {
    if (page.commonObjs.has(fontName)) {
      const f = page.commonObjs.get(fontName) as { italic?: boolean; name?: string } | null;
      if (f && (f.italic === true || /italic|oblique/i.test(f.name ?? ''))) return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

export async function extractPdf(data: Uint8Array): Promise<ExtractedDoc> {
  const doc = await pdfjs.getDocument({
    data,
    useSystemFonts: true,
  }).promise;

  const lines: ExtractedLine[] = [];

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    // Force le chargement des polices (peuple commonObjs pour l'italique).
    try {
      await page.getOperatorList();
    } catch {
      /* ignore */
    }
    const content = await page.getTextContent();
    const styles = content.styles as Record<string, { fontFamily?: string }>;

    const items: RawItem[] = [];
    for (const it of content.items) {
      if (!('str' in it) || it.str === '') continue;
      const t = it as { str: string; transform: number[]; width: number; fontName: string };
      items.push({
        str: t.str,
        x: t.transform[4]!,
        y: t.transform[5]!,
        width: t.width,
        italic: detectItalic(t.fontName, styles, page),
      });
    }

    // Regroupe par ligne (y proche), du haut vers le bas.
    interface Row {
      y: number;
      parts: RawItem[];
    }
    const rows: Row[] = [];
    for (const it of items) {
      let row = rows.find((r) => Math.abs(r.y - it.y) < 3);
      if (!row) {
        row = { y: it.y, parts: [] };
        rows.push(row);
      }
      row.parts.push(it);
    }
    rows.sort((a, b) => b.y - a.y);

    const pageLines: ExtractedLine[] = rows.map((row) => {
      const parts = row.parts.sort((a, b) => a.x - b.x);
      let text = '';
      let prevEnd: number | null = null;
      let italicChars = 0;
      let totalChars = 0;
      for (const part of parts) {
        if (prevEnd !== null && part.x - prevEnd > 1.2) text += ' ';
        text += part.str;
        prevEnd = part.x + part.width;
        const n = part.str.replace(/\s/g, '').length;
        totalChars += n;
        if (part.italic) italicChars += n;
      }
      return {
        page: p,
        x: parts.length ? parts[0]!.x : 0,
        y: row.y,
        text: text.replace(/\s+/g, ' ').trim(),
        italic: totalChars > 0 && italicChars / totalChars > 0.5,
        paragraphBreak: false,
      };
    });

    // Détection des sauts de paragraphe par écart vertical anormal.
    const gaps = pageLines
      .map((l, i) => (i > 0 ? pageLines[i - 1]!.y - l.y : 0))
      .filter((g) => g > 0)
      .sort((a, b) => a - b);
    const median = gaps.length ? gaps[Math.floor(gaps.length / 2)]! : 0;
    for (let i = 0; i < pageLines.length - 1; i++) {
      const gap = pageLines[i]!.y - pageLines[i + 1]!.y;
      if (median > 0 && gap > median * 1.6) pageLines[i]!.paragraphBreak = true;
    }
    if (pageLines.length) pageLines[pageLines.length - 1]!.paragraphBreak = true;

    lines.push(...pageLines.filter((l) => l.text !== ''));
  }

  return { numPages: doc.numPages, lines };
}
