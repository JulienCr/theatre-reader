#!/usr/bin/env -S pnpm tsx
/**
 * Exporte en PDF uniquement les tirades d'un personnage.
 *
 * Réutilise le filtre réplique-par-réplique de `@theatre/core` (`filterLinesByCharacter`,
 * distinct de `filterScenesByRoles` qui garde des scènes entières) et le pipeline
 * Playwright + Paged.js du serveur (`exportPlayPdf`) — rien n'est réimplémenté ici.
 *
 * Usage :
 *   pnpm tsx scripts/export-role/export-role.ts <slug-piece> <personnage> [options]
 *
 * Options :
 *   --placeholder   au lieu de retirer les répliques des autres personnages,
 *                    les remplace par un repère « — NOM — » (contexte minimal).
 *   --out <fichier> chemin du PDF produit (défaut : ./<slug>-<personnage>-tirades.pdf)
 *
 * <personnage> accepte l'id, le nom canonique ou un alias, insensible à la casse.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { filterLinesByCharacter, findCharacter, parseFountain } from '../../packages/core/src/index.ts';
import { exportPlayPdf } from '../../packages/server/src/export.ts';
import type { PlayMeta } from '../../packages/server/src/storage.ts';

const DATA_DIR =
  process.env.THEATRE_DATA_DIR ?? fileURLToPath(new URL('../../data/', import.meta.url));

function usage(): never {
  console.error(
    'Usage: pnpm tsx scripts/export-role/export-role.ts <slug-piece> <personnage> [--placeholder] [--out <fichier>]',
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => a !== '--placeholder' && a !== '--out');
  const [slug, characterQuery] = args;
  if (!slug || !characterQuery) usage();

  const placeholder = process.argv.includes('--placeholder');
  const outIndex = process.argv.indexOf('--out');
  const outArg = outIndex >= 0 ? process.argv[outIndex + 1] : undefined;

  const dir = join(DATA_DIR, slug);
  const fountain = await readFile(join(dir, 'play.fountain'), 'utf8');
  const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8')) as PlayMeta;

  const character = findCharacter(meta.characters, characterQuery);
  if (!character) {
    console.error(
      `Personnage « ${characterQuery} » introuvable dans « ${meta.name} ». Personnages connus : ${meta.characters.map((c) => c.canonicalName).join(', ')}`,
    );
    process.exit(1);
  }

  const play = parseFountain(fountain, meta.characters);
  const nameOf = (id: string): string =>
    meta.characters.find((c) => c.id === id)?.canonicalName ?? id;
  const filtered = filterLinesByCharacter(
    play,
    character.id,
    placeholder ? nameOf : undefined,
  );

  const pdf = await exportPlayPdf(filtered, meta.template);

  const outPath = outArg ?? join(process.cwd(), `${slug}-${character.id}-tirades.pdf`);
  await writeFile(outPath, pdf);
  console.log(`PDF écrit : ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
