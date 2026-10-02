import { describe, expect, it, vi } from 'vitest';
import { EpisodeLifecycleManager } from '../src/content/EpisodeLifecycleManager';
import { episodeKey, type AnimeContext } from '../src/anime/AnimeContext';
import { nextRetry, AUTO_RETRY_DELAYS_MS } from '../src/background/autoRetry';
const initial: AnimeContext = {
  site: 'miruro',
  title: 'Show',
  episode: 1,
  season: 1,
  pageUrl: 'https://www.miruro.to/watch/154587/show?ep=1',
};
function fixture() {
  let current = initial,
    time = 0;
  const ready = vi.fn(),
    navigate = vi.fn();
  const manager = new EpisodeLifecycleManager({
    detect: async () => current,
    url: () => current.pageUrl,
    now: () => time,
    ready,
    navigate,
  });
  return {
    manager,
    ready,
    navigate,
    set: (context: AnimeContext) => (current = context),
    tick: async (ms = 400) => {
      time += ms;
      await manager.check();
    },
  };
}
describe('episode identity and stable lifecycle', () => {
  it('uses the site catalogue identity before and after AniList enrichment', () => {
    expect(episodeKey(initial)).toBe('miruro:154587:1:1:tv');
    expect(episodeKey({ ...initial, title: '別名', anilistId: 99 })).toBe(episodeKey(initial));
    expect(episodeKey({ ...initial, episode: 2 })).not.toBe(episodeKey(initial));
    expect(episodeKey({ ...initial, season: 2 })).not.toBe(episodeKey(initial));
  });
  it('waits for stable samples, then ignores repeated DOM/player notifications', async () => {
    const f = fixture();
    await f.manager.check();
    await f.tick(100);
    expect(f.ready).not.toHaveBeenCalled();
    await f.tick(300);
    expect(f.ready).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 50; i++) await f.tick(100);
    expect(f.ready).toHaveBeenCalledTimes(1);
  });
  it('coalesces rapid EP1 → EP2 → EP3 and allows browser back to EP1', async () => {
    const f = fixture();
    await f.manager.check();
    await f.tick();
    f.set({ ...initial, episode: 2, pageUrl: initial.pageUrl.replace('ep=1', 'ep=2') });
    await f.tick(100);
    f.set({ ...initial, episode: 3, pageUrl: initial.pageUrl.replace('ep=1', 'ep=3') });
    await f.tick(100);
    await f.tick();
    expect(f.ready.mock.calls.map(([c]) => c.episode)).toEqual([1, 3]);
    expect(f.navigate).toHaveBeenCalledTimes(2);
    f.set(initial);
    await f.tick(100);
    await f.tick();
    expect(f.ready.mock.calls.map(([c]) => c.episode)).toEqual([1, 3, 1]);
  });
  it('retries missing metadata and does not restart when a title alias arrives late', async () => {
    let readyContext: AnimeContext | undefined,
      time = 0;
    const ready = vi.fn();
    const manager = new EpisodeLifecycleManager({
      detect: async () => {
        if (!readyContext) throw Error('hydrating');
        return readyContext;
      },
      url: () => initial.pageUrl,
      now: () => time,
      navigate: vi.fn(),
      ready,
    });
    await manager.check();
    readyContext = initial;
    time = 500;
    await manager.check();
    time = 900;
    await manager.check();
    expect(ready).toHaveBeenCalledTimes(1);
    readyContext = { ...initial, title: 'Native title', anilistId: 99 };
    time = 1400;
    await manager.check();
    time = 1800;
    await manager.check();
    expect(ready).toHaveBeenCalledTimes(1);
  });
  it('never accepts a result from an obsolete asynchronous detection', async () => {
    let url = initial.pageUrl,
      open!: (c: AnimeContext) => void;
    const ready = vi.fn(),
      navigate = vi.fn();
    const manager = new EpisodeLifecycleManager({
      detect: () =>
        new Promise((r) => {
          open = r;
        }),
      url: () => url,
      ready,
      navigate,
    });
    const first = manager.check();
    url = url.replace('ep=1', 'ep=2');
    await manager.check();
    open(initial);
    await first;
    expect(ready).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledOnce();
  });
  it('does not start on a non-watch page or after disposal', async () => {
    const ready = vi.fn(),
      detect = vi.fn(async () => initial);
    const manager = new EpisodeLifecycleManager({
      detect,
      url: () => 'https://www.miruro.to/',
      ready,
      navigate: vi.fn(),
    });
    await manager.check();
    expect(detect).not.toHaveBeenCalled();
    manager.stop();
    await manager.check();
    expect(ready).not.toHaveBeenCalled();
  });
});
describe('bounded automatic retry policy', () => {
  it('backs off between failures and stops after six attempts or the two-minute window', () => {
    const state = {
      key: 'episode',
      context: initial,
      startedAt: 0,
      deadlineAt: 120000,
      attempt: 1,
    };
    expect(
      AUTO_RETRY_DELAYS_MS.map((_, index) => nextRetry({ ...state, attempt: index + 1 }, 0)),
    ).toEqual([3000, 6000, 12000, 20000, 20000]);
    expect(nextRetry({ ...state, attempt: 6 }, 0)).toBeUndefined();
    expect(nextRetry(state, 119000)).toBeUndefined();
  });
});
