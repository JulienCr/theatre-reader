/**
 * Reconnaissance vocale native (iOS), vue du TypeScript.
 *
 * Adapte le plugin Swift `TheatreSpeech` (ios/App/App/SpeechPlugin.swift) à
 * l'interface que le moteur de lecture attend. Toute la logique — quand écouter,
 * comment juger, quand rejouer le modèle — vit dans @theatre/audio-player et
 * @theatre/voice-match ; il ne reste ici que la traduction d'un pont Capacitor.
 *
 * `jsName` du plugin et la chaîne passée à `registerPlugin` doivent coïncider :
 * elles sont ce qui relie les deux moitiés, et une divergence ne se voit qu'à
 * l'exécution, sur l'appareil, sous la forme d'un appel qui ne répond jamais.
 */
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { SpeechRecognizer } from '@theatre/audio-player';

interface SpeechPlugin {
  /** Demande les deux permissions (micro + reconnaissance) et rend le verdict. */
  authorize(): Promise<{ granted: boolean }>;
  start(options: { locale: string }): Promise<void>;
  stop(): Promise<void>;
  abort(): Promise<void>;
  addListener(
    event: 'partial' | 'final',
    cb: (data: { text: string }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    event: 'error',
    cb: (data: { message: string }) => void,
  ): Promise<PluginListenerHandle>;
}

const Speech = registerPlugin<SpeechPlugin>('TheatreSpeech');

/**
 * Abonnement synchrone à un pont qui, lui, s'abonne de façon asynchrone.
 *
 * `addListener` rend une promesse, alors que l'interface du moteur exige un
 * désabonnement immédiat. Ignorer cet écart laisserait un auditeur vivant quand le
 * désabonnement arrive avant l'abonnement — un micro coupé qui continue de parler
 * au lecteur. Le drapeau `off` couvre exactement cette fenêtre.
 */
function listen<T>(event: 'partial' | 'final' | 'error', cb: (d: T) => void): () => void {
  let off = false;
  let handle: PluginListenerHandle | null = null;
  void (Speech.addListener as (e: string, f: (d: T) => void) => Promise<PluginListenerHandle>)(
    event,
    (d) => {
      if (!off) cb(d);
    },
  ).then((h) => {
    handle = h;
    if (off) void h.remove();
  });
  return () => {
    off = true;
    void handle?.remove();
  };
}

/**
 * `null` hors appareil : la WebView de développement n'a ni plugin ni micro
 * autorisé, et rendre un objet qui échoue à chaque appel afficherait des réglages
 * vocaux inertes. C'est le rôle du recognizer factice (`fake.ts`).
 */
export function nativeRecognizer(): SpeechRecognizer | null {
  if (!Capacitor.isNativePlatform()) return null;
  return {
    // Les permissions sont demandées au premier besoin, pas au lancement : iOS
    // affiche alors sa demande dans un contexte compréhensible — on vient de cocher
    // « validation vocale » — plutôt qu'au milieu de la liste des pièces.
    available: async () => {
      try {
        return (await Speech.authorize()).granted;
      } catch {
        return false;
      }
    },
    start: (o) => Speech.start(o),
    stop: () => Speech.stop(),
    abort: () => Speech.abort(),
    onPartial: (cb) => listen<{ text: string }>('partial', (d) => cb(d.text)),
    onFinal: (cb) => listen<{ text: string }>('final', (d) => cb(d.text)),
    onError: (cb) => listen<{ message: string }>('error', (d) => cb(d.message)),
  };
}
