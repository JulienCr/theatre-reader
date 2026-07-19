import { defineConfig } from 'vite';

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
      'react-dom/client': 'preact/compat/client',
      'react-dom': 'preact/compat',
      react: 'preact/compat',
    },
  },
  // @theatre/core est importé en TS source (pattern "internal package") :
  // on l'exclut de l'optimiseur pour qu'esbuild le transpile tel quel.
  optimizeDeps: { exclude: ['@theatre/core'] },
  // 5173 est pris par @theatre/web : l'atelier desktop et le lecteur mobile
  // peuvent tourner en même temps.
  server: { port: 5174 },
});
