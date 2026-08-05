import { fileURLToPath } from 'node:url';
import {
  ADVERTISED_HOST,
  APP_PROBE_PORT,
  isLoopbackHost,
  lanAddresses,
  startDiscovery,
  stopDiscovery,
} from './discovery';
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
 * le même réseau peut lire les pièces et les notes. N'importe quelle adresse de
 * loopback (`127.0.0.1`, `localhost`, `::1`) referme l'accès ET coupe l'annonce mDNS.
 */
const HOST = process.env.THEATRE_HOST ?? '0.0.0.0';

const app = await buildServer();
try {
  await app.listen({ port: PORT, host: HOST });
  app.log.info(`Données stockées dans : ${dataDir()}`);

  if (!isLoopbackHost(HOST)) {
    startDiscovery(PORT, (message) => {
      app.log.warn(`Annonce mDNS impossible (${message}) — saisir l'adresse à la main dans l'app.`);
    });
    // Deux publics, deux libellés — les confondre coûte du temps de dépannage.
    //
    // Le nom `.local` est le seul que l'app iOS sache joindre (l'exception ATS
    // `NSAllowsLocalNetworking` ne couvre pas les IP privées), mais il ne résout que
    // si l'annonce mDNS aboutit — ce qui n'est pas encore connu ici : les échecs
    // d'annonce sont asynchrones et arrivent par le `warn` ci-dessus. On annonce donc
    // l'intention, jamais un fait.
    //
    // Les IP, elles, sont vraies dès maintenant puisque le serveur écoute dessus,
    // mais elles servent depuis un navigateur du réseau, pas depuis l'app.
    if (PORT === APP_PROBE_PORT) {
      app.log.info(`Découverte par l'app iOS : http://${ADVERTISED_HOST}:${PORT}`);
    } else {
      // L'annonce est correcte, mais l'app sonde un port en dur : elle ne trouvera
      // rien. Le dire ici évite de chercher du côté du mDNS, qui n'y est pour rien.
      app.log.warn(
        `PORT=${PORT} : l'app iOS ne sonde que le ${APP_PROBE_PORT}, la découverte automatique ne marchera pas — saisir http://${ADVERTISED_HOST}:${PORT} à la main dans l'app.`,
      );
    }
    for (const ip of lanAddresses()) {
      app.log.info(`Depuis un navigateur du réseau : http://${ip}:${PORT}`);
    }
  }
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

/**
 * Arrêt propre : retirer l'annonce mDNS, puis fermer Fastify, puis sortir.
 *
 * Sans le retrait, le nom reste dans le cache mDNS des clients et le téléphone croit
 * encore joindre un Mac éteint.
 *
 * `process.exit(0)` est inconditionnel, jamais accroché à la réussite de `close()` :
 * un `close()` qui rejette (socket bloqué, hook en erreur) laisserait sinon le process
 * vivant, et un Ctrl-C sans effet visible est bien pire qu'une fermeture imparfaite.
 * L'échec est logué, pas avalé.
 */
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void (async () => {
      await stopDiscovery();
      try {
        await app.close();
      } catch (err) {
        app.log.error(err, 'fermeture du serveur incomplète');
      }
      process.exit(0);
    })();
  });
}
