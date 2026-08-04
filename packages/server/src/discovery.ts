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

import os from 'node:os';
import { Bonjour } from 'bonjour-service';

/** Nom d'hôte annoncé. Doit rester synchrone avec `LAN_BASE` de l'app mobile. */
export const ADVERTISED_HOST = 'theatre-reader.local';

/** `_theatre._tcp`, déclaré aussi dans `NSBonjourServices` côté iOS. */
const SERVICE_TYPE = 'theatre';

let bonjour: Bonjour | null = null;

/**
 * Publie `_theatre._tcp` avec `theatre-reader.local` comme cible.
 *
 * `host` ne fait pas que remplir le SRV : bonjour-service émet aussi un
 * enregistrement A portant ce nom pour chaque interface IPv4 non interne. C'est ce
 * A record — et lui seul — qui rend le nom résolvable depuis le téléphone.
 *
 * Ne lève jamais : une annonce impossible (port 5353 pris, réseau exotique) ne doit
 * pas empêcher le serveur de démarrer. La saisie manuelle et Tailscale restent
 * opérationnelles, et les URL utilisables sont de toute façon logguées au démarrage.
 */
export function startDiscovery(port: number, onError: (message: string) => void): void {
  try {
    bonjour = new Bonjour();
    bonjour.publish({
      // Affiché par `dns-sd -B _theatre._tcp` : le nom de la machine aide à s'y
      // retrouver quand plusieurs Mac tournent sur le même réseau.
      name: os.hostname(),
      type: SERVICE_TYPE,
      port,
      host: ADVERTISED_HOST,
    });
  } catch (err: unknown) {
    onError(err instanceof Error ? err.message : String(err));
  }
}

/**
 * Retire l'annonce (paquets d'adieu, TTL 0) puis ferme le socket mDNS.
 *
 * Sans ça le nom traîne dans le cache des clients après l'arrêt du serveur, et le
 * téléphone croit encore joindre un Mac éteint.
 */
export function stopDiscovery(): void {
  const instance = bonjour;
  bonjour = null;
  instance?.unpublishAll(() => instance.destroy());
}

/** IPv4 des interfaces réelles, pour logguer les adresses de repli au démarrage. */
export function lanAddresses(): string[] {
  return Object.values(os.networkInterfaces())
    .flatMap((infos) => infos ?? [])
    .filter((i) => i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}
