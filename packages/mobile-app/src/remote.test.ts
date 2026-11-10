import { afterEach, describe, expect, it, vi } from 'vitest';
import { headsetRemote } from './remote';

type Handler = (() => void) | null;

function stubMediaSession() {
  const handlers: Record<string, Handler> = {};
  const session = {
    metadata: null as unknown,
    playbackState: 'none',
    setActionHandler: vi.fn((action: string, h: Handler) => {
      handlers[action] = h;
    }),
  };
  vi.stubGlobal('navigator', { mediaSession: session });
  vi.stubGlobal('MediaMetadata', class { constructor(public init: object) {} });
  return { session, handlers };
}

afterEach(() => vi.unstubAllGlobals());

describe('headsetRemote', () => {
  it('is absent where the WebView has no Media Session', () => {
    vi.stubGlobal('navigator', {});
    expect(headsetRemote('Play')).toBeNull();
  });

  it('turns nexttrack/previoustrack into commands, with metadata so the page can be Now Playing', () => {
    const { session, handlers } = stubMediaSession();
    const cb = vi.fn();
    headsetRemote('Play')!.onCommand(cb);
    handlers['nexttrack']!();
    handlers['previoustrack']!();
    expect(cb.mock.calls).toEqual([['next'], ['previous']]);
    expect(session.metadata).toMatchObject({ init: { title: 'Play' } });
  });

  it('releases the handlers and metadata once unsubscribed', () => {
    const { session, handlers } = stubMediaSession();
    const off = headsetRemote('Play')!.onCommand(vi.fn());
    off();
    expect(handlers['nexttrack']).toBeNull();
    expect(handlers['previoustrack']).toBeNull();
    expect(session.metadata).toBeNull();
  });

  it('keeps the session "playing" through pauses until told otherwise', () => {
    const { session } = stubMediaSession();
    const remote = headsetRemote('Play')!;
    remote.setActive!(true);
    expect(session.playbackState).toBe('playing');
    remote.setActive!(false);
    expect(session.playbackState).toBe('paused');
  });
});
