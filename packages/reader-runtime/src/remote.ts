import type { Player } from '@theatre/audio-player';

/** Track-skip commands a headset can send. */
export type RemoteCommand = 'next' | 'previous';

/**
 * Hardware transport (headset buttons), injected by the host like the recognizer.
 * Absent in the exported .html: nothing there can receive such a command.
 */
export interface RemoteControls {
  /** Subscribes to commands and returns the unsubscribe. */
  onCommand(cb: (command: RemoteCommand) => void): () => void;
  /** True while a session runs, rehearsal pauses and open mic included (no clip needs to sound). */
  setActive?(active: boolean): void;
}

/**
 * Routes headset commands to the very actions of the on-screen transport, so
 * `prev()`/`next()` keep their rehearsal semantics (skip, back to scene entry).
 * `getPlayer` is a getter because the player is created after the first render.
 */
export function bindRemote(remote: RemoteControls, getPlayer: () => Player | null): () => void {
  return remote.onCommand((command) => {
    const player = getPlayer();
    if (!player) return;
    if (command === 'next') player.next();
    else player.prev();
  });
}
