import { describe, expect, it, vi } from 'vitest';
import type { Player } from '@theatre/audio-player';
import { bindRemote, type RemoteCommand, type RemoteControls } from './remote';

function fakeRemote() {
  const subscribers: ((c: RemoteCommand) => void)[] = [];
  const remote: RemoteControls = {
    onCommand: (cb) => {
      subscribers.push(cb);
      return () => subscribers.splice(subscribers.indexOf(cb), 1);
    },
  };
  return { remote, send: (c: RemoteCommand) => subscribers.slice().forEach((s) => s(c)), subscribers };
}

const fakePlayer = () => ({ next: vi.fn(), prev: vi.fn() }) as unknown as Player;

describe('bindRemote', () => {
  it('maps next and previous to the player transport', () => {
    const { remote, send } = fakeRemote();
    const player = fakePlayer();
    bindRemote(remote, () => player);
    send('next');
    send('previous');
    send('previous');
    expect(player.next).toHaveBeenCalledTimes(1);
    expect(player.prev).toHaveBeenCalledTimes(2);
  });

  it('reads the player at command time, and ignores commands while there is none', () => {
    const { remote, send } = fakeRemote();
    let current: Player | null = null;
    bindRemote(remote, () => current);
    expect(() => send('next')).not.toThrow();
    current = fakePlayer();
    send('next');
    expect(current.next).toHaveBeenCalledTimes(1);
  });

  it('stops listening once unbound', () => {
    const { remote, send, subscribers } = fakeRemote();
    const player = fakePlayer();
    const unbind = bindRemote(remote, () => player);
    unbind();
    send('next');
    expect(subscribers).toHaveLength(0);
    expect(player.next).not.toHaveBeenCalled();
  });
});
