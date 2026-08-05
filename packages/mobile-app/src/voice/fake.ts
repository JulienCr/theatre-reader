/**
 * Reconnaissance vocale simulée, pour développer la boucle dans un navigateur.
 *
 * Sans elle, rien de la répétition vocale ne se vérifie sans iPhone connecté :
 * chaque retouche de la boucle demanderait un `pnpm ios` complet, et la moitié des
 * cas (silence, autocorrection, deux échecs de suite) sont pénibles à reproduire à
 * la voix. Ici, on les dicte.
 *
 *   __THEATRE_FAKE_SPEECH__.say('je ne reviendrai jamais')   // résultat partiel
 *   __THEATRE_FAKE_SPEECH__.finalize('...')                  // résultat final
 *   __THEATRE_FAKE_SPEECH__.fail('micro refusé')             // erreur du moteur
 *   __THEATRE_FAKE_SPEECH__.listening                        // le micro est-il ouvert
 *
 * Jamais active sur appareil (cf. `pickRecognizer`) : c'est un outil de mise au
 * point, pas un repli. Un vrai téléphone sans permission doit dire non, pas faire
 * semblant d'entendre.
 */
import type { SpeechRecognizer } from '@theatre/audio-player';

export interface FakeSpeechConsole {
  say(text: string): void;
  finalize(text: string): void;
  fail(message: string): void;
  readonly listening: boolean;
}

declare global {
  interface Window {
    __THEATRE_FAKE_SPEECH__?: FakeSpeechConsole;
  }
}

export function fakeRecognizer(): SpeechRecognizer {
  const partials: ((t: string) => void)[] = [];
  const finals: ((t: string) => void)[] = [];
  const errors: ((m: string) => void)[] = [];
  let live = false;

  const drop = <T>(list: T[], item: T) => (): void => {
    const i = list.indexOf(item);
    if (i >= 0) list.splice(i, 1);
  };

  const console_: FakeSpeechConsole = {
    say: (text) => {
      if (live) partials.slice().forEach((cb) => cb(text));
    },
    finalize: (text) => {
      if (live) finals.slice().forEach((cb) => cb(text));
    },
    fail: (message) => {
      if (live) errors.slice().forEach((cb) => cb(message));
    },
    get listening() {
      return live;
    },
  };
  window.__THEATRE_FAKE_SPEECH__ = console_;

  return {
    available: () => Promise.resolve(true),
    start: () => {
      live = true;
      // Trace volontaire : dans un navigateur, rien d'autre ne signale que le micro
      // « s'ouvre », et c'est précisément ce qu'on vient vérifier.
      console.info('[voix simulée] écoute — __THEATRE_FAKE_SPEECH__.say("…")');
      return Promise.resolve();
    },
    stop: () => {
      live = false;
      return Promise.resolve();
    },
    abort: () => {
      live = false;
      return Promise.resolve();
    },
    onPartial: (cb) => {
      partials.push(cb);
      return drop(partials, cb);
    },
    onFinal: (cb) => {
      finals.push(cb);
      return drop(finals, cb);
    },
    onError: (cb) => {
      errors.push(cb);
      return drop(errors, cb);
    },
  };
}
