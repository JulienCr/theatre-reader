/**
 * Choix de la reconnaissance vocale à donner au lecteur.
 *
 * Sur appareil : le plugin natif, et lui seul. Ailleurs : le simulateur, qui rend
 * la boucle jouable dans un navigateur. Un `null` est une réponse valable — le
 * lecteur n'affiche alors aucun réglage vocal, ce qui vaut mieux qu'une case à
 * cocher qui n'écouterait rien.
 */
import { Capacitor } from '@capacitor/core';
import type { SpeechRecognizer } from '@theatre/audio-player';
import { fakeRecognizer } from './fake';
import { nativeRecognizer } from './native';

export function pickRecognizer(): SpeechRecognizer | null {
  if (Capacitor.isNativePlatform()) return nativeRecognizer();
  // `import.meta.env.DEV` : le simulateur ne part JAMAIS dans un build. Une app
  // installée qui prétendrait entendre serait pire que pas de mode vocal du tout.
  return import.meta.env.DEV ? fakeRecognizer() : null;
}
