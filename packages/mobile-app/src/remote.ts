/**
 * Headset next/previous buttons, through the Media Session API.
 *
 * WebKit owns the process-wide MPRemoteCommandCenter for the audio element and
 * rewrites it at every playback change, so a native handler gets overridden.
 * Declaring the handlers here lets WebKit route the buttons to us itself.
 * What a press does is decided by the player; this file only carries the event.
 */
import type { RemoteControls } from '@theatre/reader-runtime';

/** `null` when the WebView has no Media Session (the reader then has no hardware transport). */
export function headsetRemote(title: string): RemoteControls | null {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return null;
  const session = navigator.mediaSession;
  return {
    onCommand: (cb) => {
      session.metadata = new MediaMetadata({ title, artist: 'Theatre Reader' });
      session.setActionHandler('nexttrack', () => cb('next'));
      session.setActionHandler('previoustrack', () => cb('previous'));
      return () => {
        session.setActionHandler('nexttrack', null);
        session.setActionHandler('previoustrack', null);
        session.metadata = null;
      };
    },
    // A rehearsal pause or an open mic plays no clip: without this the page reads as stopped.
    setActive: (active) => {
      session.playbackState = active ? 'playing' : 'paused';
    },
  };
}
