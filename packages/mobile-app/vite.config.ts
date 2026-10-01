import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { defineConfig } from 'vite';

// Vite résout un alias depuis le fichier importateur : les composants partagés
// (reader-ui, ui) ne déclarent pas preact, donc `preact/compat` y est introuvable
// dans l'agencement pnpm isolé. On l'épingle sur le preact de ce paquet.
const preact = dirname(createRequire(import.meta.url).resolve('preact/package.json'));

export default defineConfig({
  resolve: {
    // Le chrome du lecteur est écrit en React (composants partagés avec l'app
    // web) mais bundlé sur Preact : React + ReactDOM pèsent ~140 kB bruts pour
    // un usage sur téléphone, Preact ~12 kB. Même aliasage que le bundle
    // esbuild de l'export .html (server/src/reader-export.ts) ; seul le BUNDLE
    // est aliasé, le typecheck garde @types/react.
    alias: {
      // Sous-chemin distinct : `preact/compat` n'exporte pas createRoot, il vit
      // dans `preact/compat/client`.
      'react-dom/client': `${preact}/compat/client`,
      'react-dom': `${preact}/compat`,
      react: `${preact}/compat`,
    },
  },
  // @theatre/core est importé en TS source (pattern "internal package") :
  // on l'exclut de l'optimiseur pour qu'esbuild le transpile tel quel.
  optimizeDeps: { exclude: ['@theatre/core'] },
  // 5173 est pris par @theatre/web : l'atelier desktop et le lecteur mobile
  // peuvent tourner en même temps.
  server: { port: 5174 },
});
