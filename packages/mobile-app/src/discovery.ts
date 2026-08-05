/**
 * Trouver le Mac sans que personne n'ait à taper d'adresse.
 *
 * Le serveur publie en mDNS un nom d'hôte FIXE (`server/src/discovery.ts`) ; l'app
 * n'a donc rien à parcourir, elle interroge ce nom directement. C'est ce qui évite
 * un plugin Capacitor de découverte : iOS résout les `.local` nativement.
 *
 * Deux pièges iOS que ce module contourne, et qui expliquent sa forme :
 *
 * 1. La sonde passe par `CapacitorHttp` sur appareil, pas par `fetch`. C'est un
 *    URLSession natif, donc iOS affiche bien la demande de permission « réseau
 *    local » (iOS 14+). Une requête émise depuis la WebView peut, elle, échouer
 *    sans jamais déclencher le prompt — l'app conclurait « Mac introuvable » alors
 *    que le serveur répond très bien. Une fois la permission accordée, les `fetch`
 *    ordinaires (téléchargement des clips) passent.
 * 2. On vise un nom `.local` et jamais une IP : l'exception ATS
 *    `NSAllowsLocalNetworking` de l'Info.plist ne couvre que les noms Bonjour.
 */

import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { getManualBase, setActiveBase } from './settings';

/** Doit rester synchrone avec `ADVERTISED_HOST` / `PORT` côté serveur. */
const LAN_BASE = 'http://theatre-reader.local:3001';

/** Assez pour un aller-retour Wi-Fi, assez court pour ne pas figer l'écran. */
const TIMEOUT_MS = 2500;

export interface Instance {
  /** Base à passer à `setActiveBase`. */
  base: string;
  /** Nom de machine renvoyé par `/api/health`, affiché dans l'app. */
  host: string;
  /** Vrai si on est passé par l'adresse saisie à la main (Tailscale). */
  manual: boolean;
}

/** Injectable pour les tests ; en vrai c'est CapacitorHttp ou fetch. */
export type Probe = (url: string) => Promise<unknown>;

/**
 * Interroge `/api/health` et ne retient la base que si la réponse porte le marqueur
 * de l'app.
 *
 * Un simple 200 ne suffit pas : sur un réseau d'entreprise, un portail captif ou un
 * proxy répond 200 à peu près à tout. Sans cette vérification, l'app se croirait
 * connectée et enchaînerait sur des appels qui échouent un par un.
 */
export async function probeBase(base: string, probe: Probe = defaultProbe): Promise<string | null> {
  if (!base) return null;
  try {
    const body = await probe(`${base}/api/health`);
    const health = body as { app?: string; host?: string } | null;
    if (health?.app !== 'theatre-reader') return null;
    return health.host ?? '';
  } catch {
    // Mac éteint, hors du tailnet, permission réseau local refusée, adresse fausse :
    // tous ces cas se valent ici — il n'y a pas d'instance à cette adresse.
    return null;
  }
}

/**
 * Adresse manuelle d'abord, réseau local ensuite.
 *
 * L'ordre est un choix produit : Tailscale marche partout et en HTTPS, donc si une
 * adresse a été saisie c'est elle qui fait autorité. La découverte LAN n'est là que
 * pour le cas — le plus courant — où rien n'a jamais été configuré.
 *
 * Pose la base trouvée dans `settings` et la retourne, ou `null` si aucune ne répond.
 */
export async function discover(probe: Probe = defaultProbe): Promise<Instance | null> {
  const candidates: { base: string; manual: boolean }[] = [
    { base: getManualBase(), manual: true },
    { base: LAN_BASE, manual: false },
  ];
  for (const { base, manual } of candidates) {
    const host = await probeBase(base, probe);
    if (host !== null) {
      setActiveBase(manual ? null : base);
      return { base, host, manual };
    }
  }
  setActiveBase(null);
  return null;
}

/** Adresse LAN proposée à l'utilisateur quand la découverte échoue, pour le dépannage. */
export const lanBase = LAN_BASE;

async function defaultProbe(url: string): Promise<unknown> {
  if (Capacitor.isNativePlatform()) {
    // `readTimeout`/`connectTimeout` sont en millisecondes et gérés côté natif :
    // pas d'AbortController à câbler, contrairement à la branche fetch.
    const res = await CapacitorHttp.get({
      url,
      readTimeout: TIMEOUT_MS,
      connectTimeout: TIMEOUT_MS,
    });
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    // Le plugin parse déjà le JSON quand le content-type s'y prête ; sinon on reçoit
    // le texte brut et il faut le faire soi-même.
    return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}
