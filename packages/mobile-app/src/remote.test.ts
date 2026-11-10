import { describe, expect, it, vi } from 'vitest';
import { headsetRemote } from './remote';

const fakePlugin = () => ({
  armRemote: vi.fn().mockResolvedValue(undefined),
  disarmRemote: vi.fn().mockResolvedValue(undefined),
  setRemoteActive: vi.fn().mockResolvedValue(undefined),
});

describe('headsetRemote', () => {
  it('is absent off device', () => {
    expect(headsetRemote('Play', null)).toBeNull();
  });

  it('arms the native plugin with the play title on subscribe and disarms on unsubscribe', () => {
    const plugin = fakePlugin();
    const off = headsetRemote('Play', plugin)!.onCommand(vi.fn());
    expect(plugin.armRemote).toHaveBeenCalledWith({ title: 'Play' });
    off();
    expect(plugin.disarmRemote).toHaveBeenCalledTimes(1);
  });

  it('forwards the session state so Now Playing reads playing through pauses', () => {
    const plugin = fakePlugin();
    const remote = headsetRemote('Play', plugin)!;
    remote.setActive!(true);
    remote.setActive!(false);
    expect(plugin.setRemoteActive.mock.calls).toEqual([[{ active: true }], [{ active: false }]]);
  });

  it('survives a plugin that rejects (bridge missing)', async () => {
    const plugin = fakePlugin();
    plugin.armRemote.mockRejectedValue(new Error('no plugin'));
    plugin.setRemoteActive.mockRejectedValue(new Error('no plugin'));
    const remote = headsetRemote('Play', plugin)!;
    remote.onCommand(vi.fn());
    remote.setActive!(true);
    await Promise.resolve();
  });
});
