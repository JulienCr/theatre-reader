import { fileURLToPath } from 'node:url';
import { ADVERTISED_HOST, lanAddresses, startDiscovery, stopDiscovery } from './discovery';
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

/**
 * Toutes les interfaces par défaut : c'est ce qui permet au téléphone de joindre le
 * Mac sur le Wi-Fi de la salle, sans Tailscale ni adresse à saisir.
 *
 * Contrepartie assumée : l'API n'a aucune authentification, donc quiconque est sur
 * le même réseau peut lire les pièces et les notes. `THEATRE_HOST=127.0.0.1` referme
 * l'accès à la loopback.
 */
const HOST = process.env.THEATRE_HOST ?? '0.0.0.0';

const app = await buildServer();
try {
  await app.listen({ port: PORT, host: HOST });
  app.log.info(`Données stockées dans : ${dataDir()}`);

  if (HOST !== '127.0.0.1') {
    startDiscovery(PORT, (message) => {
      app.log.warn(`Annonce mDNS impossible (${message}) — saisir l'adresse à la main dans l'app.`);
    });
    // Les adresses sont logguées même quand l'annonce réussit : c'est le filet de
    // secours si la découverte échoue côté téléphone (permission « réseau local »
    // refusée, Wi-Fi qui isole les clients), et il faut alors pouvoir les recopier.
    for (const url of [`http://${ADVERTISED_HOST}:${PORT}`, ...lanAddresses().map((ip) => `http://${ip}:${PORT}`)]) {
      app.log.info(`Joignable depuis le téléphone : ${url}`);
    }
  }
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

// Sans retrait explicite, le nom reste dans le cache mDNS des clients : le téléphone
// croirait encore joindre un Mac éteint.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    stopDiscovery();
    void app.close().then(() => process.exit(0));
  });
}
