/**
 * Annonce mDNS du serveur, pour que le téléphone le trouve sans qu'on lui saisisse
 * d'adresse.
 *
 * Tout repose sur un nom d'hôte FIXE, `theatre-reader.local`, que l'app mobile code
 * en dur. C'est ce qui évite un plugin Capacitor de découverte : iOS résout les noms
 * `.local` nativement, l'app n'a qu'à faire une requête HTTP dessus.
 *
 * Le nom `.local` n'est pas un détail cosmétique — c'est ce qui rend le HTTP en clair
 * possible sur iOS. L'App Transport Security bloque le cleartext, sauf via
 * `NSAllowsLocalNetworking` (posé dans le `Info.plist` de l'app), qui couvre
 * précisément les noms Bonjour `.local` et le link-local, mais PAS les IP privées
 * 192.168.x.x. Annoncer une IP à la place du nom rendrait l'exception inopérante.
 */

import type { EventEmitter } from 'node:events';
import os from 'node:os';
import { Bonjour } from 'bonjour-service';

/** Nom d'hôte annoncé. Doit rester synchrone avec `LAN_BASE` de l'app mobile. */
export const ADVERTISED_HOST = 'theatre-reader.local';

/** `_theatre._tcp`, déclaré aussi dans `NSBonjourServices` côté iOS. */
const SERVICE_TYPE = 'theatre';

/**
 * Adresse d'écoute qui ne sort pas de la machine, sous toutes ses écritures.
 *
 * Annoncer `theatre-reader.local` alors que le serveur n'écoute que sur la loopback
 * est pire que ne rien annoncer : le nom résout vers l'IP LAN, le téléphone s'y
 * connecte, et se fait refuser sans que rien n'explique pourquoi. Ne comparer qu'à
 * `127.0.0.1` laisserait passer `localhost` et `::1`, qui referment tout autant.
 */
export function isLoopbackHost(host: string): boolean {
  const bare = host.trim().replace(/^\[|\]$/g, '').toLowerCase();
  return bare === 'localhost' || bare === '::1' || /^127(\.\d{1,3}){3}$/.test(bare);
}

let bonjour: Bonjour | null = null;

/**
 * Publie `_theatre._tcp` avec `theatre-reader.local` comme cible.
 *
 * `host` ne fait pas que remplir le SRV : bonjour-service émet aussi un
 * enregistrement A portant ce nom pour chaque interface IPv4 non interne. C'est ce
 * A record — et lui seul — qui rend le nom résolvable depuis le téléphone.
 *
 * Ne tue jamais le serveur : une annonce impossible (port 5353 pris, réseau exotique)
 * ne doit pas empêcher de démarrer. La saisie manuelle et Tailscale restent
 * opérationnelles, et les URL utilisables sont de toute façon logguées au démarrage.
 *
 * Quatre chemins d'échec distincts, et le `try/catch` n'en couvre qu'un : les trois
 * autres sont ASYNCHRONES, donc hors de sa portée. Les quatre doivent finir dans
 * `onError`, sans quoi le serveur se croit annoncé et le téléphone ne trouve rien.
 * 1. échec synchrone de la construction / publication → `try/catch` ;
 * 2. échec d'un `respond()` → sans second argument au constructeur, la lib fait
 *    `throw err` depuis son propre callback (`mdns-server.js`), ce qui donne une
 *    exception non capturée. D'où l'`errorCallback` passé ici ;
 * 3. échec du socket (EADDRINUSE / EACCES sur 5353) → `multicast-dns` émet `error`
 *    sur son émetteur, que `bonjour-service` n'écoute pas. Un `EventEmitter` sans
 *    écouteur `error` LÈVE : sans le branchement ci-dessous, le cas « port 5353 déjà
 *    pris » ferait exactement ce qu'on cherche à éviter ;
 * 4. nom déjà pris sur le réseau → la lib abandonne la publication et se contente
 *    d'un `console.log` (`registry.js`), sans exception ni callback. Rien ne serait
 *    annoncé, et rien ne le dirait. D'où la surveillance de `published`.
 */
export function startDiscovery(port: number, onError: (message: string) => void): void {
  const report = (err: unknown): void =>
    onError(err instanceof Error ? err.message : String(err));
  try {
    bonjour = new Bonjour(undefined, report);
    listenForSocketErrors(bonjour, report);
    const service = bonjour.publish({
      // Affiché par `dns-sd -B _theatre._tcp` : le nom de la machine aide à s'y
      // retrouver quand plusieurs Mac tournent sur le même réseau.
      name: os.hostname(),
      type: SERVICE_TYPE,
      port,
      host: ADVERTISED_HOST,
    });
    watchPublication(service, report);
  } catch (err: unknown) {
    report(err);
  }
}

/**
 * Vérifie, après coup, que l'annonce est bien partie (chemin 4 ci-dessus).
 *
 * Le cas qui rend ça nécessaire n'a rien d'exotique : un redémarrage de `tsx watch`
 * tué sans SIGTERM laisse l'ancienne annonce vivre le temps de son TTL, la nouvelle
 * instance sonde, trouve son propre fantôme, et renonce en silence.
 *
 * `unref()` : ce minuteur ne doit pas être une raison de garder le process en vie.
 */
function watchPublication(service: { published: boolean }, report: (err: unknown) => void): void {
  // La lib diffuse immédiatement après une sonde d'environ 750 ms ; 3 s laissent une
  // marge confortable sans retarder le moindre démarrage (le minuteur ne bloque rien).
  setTimeout(() => {
    if (service.published) return;
    report(
      new Error(
        `annonce non diffusée — le nom « ${os.hostname()} » ou ${ADVERTISED_HOST} est déjà pris sur le réseau`,
      ),
    );
  }, 3000).unref();
}

/**
 * Branche un écouteur sur l'émetteur `multicast-dns` interne (chemin 3 ci-dessus).
 *
 * `server` est privé dans les typings mais bien présent à l'exécution, et c'est le
 * seul accès à cet émetteur : `Bonjour` n'expose rien. L'`?.` est là pour ça — si une
 * version future de la lib change cette forme, on se retrouve simplement sans
 * écouteur, c'est-à-dire dans l'état d'avant ce correctif, jamais en erreur.
 */
function listenForSocketErrors(instance: Bonjour, report: (err: unknown) => void): void {
  const mdns = (instance as unknown as { server?: { mdns?: EventEmitter } }).server?.mdns;
  mdns?.on('error', report);
}

/** Au-delà, on part sans les paquets d'adieu plutôt que de retenir un Ctrl-C. */
const UNPUBLISH_TIMEOUT_MS = 500;

/**
 * Retire l'annonce (paquets d'adieu, TTL 0) puis ferme le socket mDNS.
 *
 * Sans ça le nom traîne dans le cache des clients après l'arrêt du serveur, et le
 * téléphone croit encore joindre un Mac éteint.
 *
 * Rendue attendable : `unpublishAll` est asynchrone, et l'appelant sort du process
 * juste après. Sans attente, `process.exit()` gagne la course et les paquets d'adieu
 * ne partent jamais — la fonction ne servirait alors à rien. Le délai plafonne
 * l'attente : un socket coincé ne doit pas transformer un Ctrl-C en blocage.
 */
export function stopDiscovery(): Promise<void> {
  const instance = bonjour;
  bonjour = null;
  if (!instance) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const done = (): void => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, UNPUBLISH_TIMEOUT_MS);
    instance.unpublishAll(() => {
      instance.destroy();
      done();
    });
  });
}

/** IPv4 des interfaces réelles, pour logguer les adresses de repli au démarrage. */
export function lanAddresses(): string[] {
  return Object.values(os.networkInterfaces())
    .flatMap((infos) => infos ?? [])
    .filter((i) => i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}
