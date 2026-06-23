import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // @theatre/core est importé en TS source (pattern "internal package") :
  // on l'exclut de l'optimiseur pour qu'esbuild le transpile tel quel.
  optimizeDeps: { exclude: ['@theatre/core'] },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:3001',
    },
  },
});
