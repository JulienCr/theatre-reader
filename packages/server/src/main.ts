import { fileURLToPath } from 'node:url';
import { buildServer } from './server';
import { dataDir } from './storage';

// Charge le .env de la racine du dépôt avant tout (ELEVENLABS_API_KEY, PORT, …),
// pour que le TTS soit actif par défaut aussi bien en `dev` qu'en `start`. Les
// variables déjà présentes dans l'environnement (ex. clé injectée par
// scripts/with-elevenlabs.sh via 1Password) gardent la priorité et ne sont pas
// écrasées. Fichier absent (ou Node < 20.12) : on ignore, le serveur démarre —
// le TTS se guarde de lui-même via hasElevenLabsKey().
if (typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
  } catch {
    /* pas de .env : la clé est fournie autrement (op) ou le TTS reste désactivé */
  }
}

const PORT = Number(process.env.PORT ?? 3001);

const app = await buildServer();
try {
  await app.listen({ port: PORT, host: '127.0.0.1' });
  app.log.info(`Données stockées dans : ${dataDir()}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
