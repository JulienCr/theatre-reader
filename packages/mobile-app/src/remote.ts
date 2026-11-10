/**
 * Headset next/previous buttons, through the native plugin.
 *
 * WKWebView's Media Session never reached the app (no Now Playing client in the app
 * process), so the app registers MPRemoteCommandCenter itself (SpeechPlugin.swift).
 * What a press does is decided by the player; this file only carries the event.
 */
import { Capacitor } from '@capacitor/core';
import type { RemoteControls } from '@theatre/reader-runtime';
import { listen, Speech } from './voice/native';

type RemotePlugin = Pick<typeof Speech, 'armRemote' | 'disarmRemote' | 'setRemoteActive'>;

/** `null` off device: the web dev server has no headset transport to receive. */
export function headsetRemote(
  title: string,
  plugin: RemotePlugin | null = Capacitor.isNativePlatform() ? Speech : null,
): RemoteControls | null {
  if (!plugin) return null;
  return {
    onCommand: (cb) => {
      const off = listen<{ command: 'next' | 'previous' }>('remoteCommand', (d) => cb(d.command));
      void plugin.armRemote({ title }).catch(() => {});
      return () => {
        off();
        void plugin.disarmRemote().catch(() => {});
      };
    },
    // A rehearsal pause or an open mic plays no clip: without this the app reads as stopped.
    setActive: (active) => {
      void plugin.setRemoteActive({ active }).catch(() => {});
    },
  };
}
