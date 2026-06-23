/**
 * Export PDF via Playwright (Chromium headless) + Paged.js.
 *
 * Paged.js pagine le document HTML dans le navigateur (moteur CSS Paged Media) :
 * il résout les `target-counter` du sommaire (n° de page des actes/scènes) et
 * les compteurs `counter(page)/counter(pages)` du pied de page — ce que Chromium
 * seul ne sait pas faire. On imprime ensuite le résultat paginé en PDF.
 */

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { Character, Template, parseFountain, renderDocument } from '@theatre/core';

const require = createRequire(import.meta.url);
// Le champ `exports` de pagedjs n'expose pas le polyfill en sous-chemin standard ;
// on remonte à la racine du package pour lire le bundle directement.
const PAGED_ROOT = (() => {
  const entry = require.resolve('pagedjs');
  return entry.slice(0, entry.lastIndexOf('pagedjs') + 'pagedjs'.length);
})();
const PAGED_POLYFILL_PATH = join(PAGED_ROOT, 'dist', 'paged.polyfill.js');

let pagedSourceCache: string | null = null;
async function pagedPolyfill(): Promise<string> {
  if (pagedSourceCache === null) {
    pagedSourceCache = await readFile(PAGED_POLYFILL_PATH, 'utf8');
  }
  return pagedSourceCache;
}

export async function exportPdf(
  fountain: string,
  characters: Character[],
  template: Template,
): Promise<Buffer> {
  const play = parseFountain(fountain, characters);
  const html = renderDocument(play, template);

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });

    // Pagination par Paged.js, en mode manuel pour pouvoir l'attendre.
    await page.evaluate(() => {
      (globalThis as Record<string, unknown>).PagedConfig = { auto: false };
    });
    await page.addScriptTag({ content: await pagedPolyfill() });
    await page.evaluate(async () => {
      const polyfill = (globalThis as Record<string, unknown>).PagedPolyfill as {
        preview: () => Promise<unknown>;
      };
      await polyfill.preview();
    });
    await page.waitForSelector('.pagedjs_pages', { timeout: 30000 });

    const pdf = await page.pdf({
      printBackground: true, // surlignages
      preferCSSPageSize: true, // taille/marges des @page produites par Paged.js
    });
    return pdf;
  } finally {
    await browser.close();
  }
}
