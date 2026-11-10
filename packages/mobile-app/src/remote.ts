/**
 * Headset next/previous buttons, seen from TypeScript.
 *
 * Adapts the `armRemote` / `remoteCommand` half of the Swift plugin
 * (ios/App/App/SpeechPlugin.swift) to the `RemoteControls` the reader expects.
 * What a press does is decided by the player; this file only carries the event.
 */
import { Capacitor } from '@capacitor/core';
import type { RemoteControls } from '@theatre/reader-runtime';
import { listen, Speech } from './voice/native';

/** `null` off device: the WebView has no plugin and no headset. */
export function nativeRemote(title: string): RemoteControls | null {
  if (!Capacitor.isNativePlatform()) return null;
  return {
    onCommand: (cb) => {
      const off = listen<{ command: 'next' | 'previous' }>('remoteCommand', (d) => cb(d.command));
      // Arm after subscribing: a press right after arming must find a listener.
      Speech.armRemote({ title }).catch(() => {});
      return () => {
        off();
        Speech.disarmRemote().catch(() => {});
      };
    },
  };
}
