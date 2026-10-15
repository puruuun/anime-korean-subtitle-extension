// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultDisplay } from '../src/subtitle/SubtitleRenderer';
vi.mock('../src/content/bridgeStore', () => ({
  installBridgeListener: vi.fn(),
  clearBridge: vi.fn(),
}));
vi.mock('../src/content/navigationObserver', () => ({ observeNavigation: () => vi.fn() }));
vi.mock('../src/sites/adapter', () => ({ adapterFor: () => null }));
type Message = Record<string, unknown>;
type Reply = Record<string, unknown>;
type Listener = (
  message: Message,
  sender: chrome.runtime.MessageSender,
  reply: (reply: Reply) => void,
) => boolean | void;
let listener: Listener;
let video: HTMLVideoElement;
let playing = false;
let pause: ReturnType<typeof vi.fn>;
let play: ReturnType<typeof vi.fn>;
let send: ReturnType<typeof vi.fn>;
let root: ShadowRoot;

async function dispatch(message: Message): Promise<Reply> {
  return new Promise((resolve) => {
    listener(message, {}, resolve);
  });
}
beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  delete window.__animeSubIsolatedV1;
  document.body.innerHTML = '<video></video>';
  video = document.querySelector('video')!;
  playing = false;
  Object.defineProperty(video, 'paused', { get: () => !playing, configurable: true });
  pause = vi.fn(() => {
    playing = false;
    video.dispatchEvent(new Event('pause'));
  });
  play = vi.fn(() => {
    playing = true;
    video.dispatchEvent(new Event('play'));
    return Promise.resolve();
  });
  Object.defineProperty(video, 'pause', { value: pause, configurable: true });
  Object.defineProperty(video, 'play', { value: play, configurable: true });
  vi.spyOn(video, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 640,
    bottom: 360,
    width: 640,
    height: 360,
    toJSON() {},
  });
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
  const original = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string, ...args: unknown[]) => {
    const element = original(tag, ...(args as []));
    if (tag === 'div') {
      const attach = element.attachShadow.bind(element);
      vi.spyOn(element, 'attachShadow').mockImplementation(() => {
        root = attach({ mode: 'open' });
        return root;
      });
    }
    return element;
  }) as typeof document.createElement);
  send = vi.fn().mockResolvedValue(null);
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage: send,
      onMessage: {
        addListener: (handler: Listener) => {
          listener = handler;
        },
      },
    },
  });
  await import('../src/content/contentScript');
  await Promise.resolve();
});
afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete window.__animeSubIsolatedV1;
  document.body.innerHTML = '';
});

describe('progressive player isolation', () => {
  it('clears both tracks and rejects Japanese messages from the previous episode', async () => {
    await dispatch({
      type: 'APPLY',
      epoch: 5,
      display: { ...defaultDisplay, showJapanese: true },
      cues: [{ id: 1, startTime: 1, endTime: 4, text: '한국어' }],
    });
    await dispatch({
      type: 'JAPANESE_CUES',
      epoch: 5,
      cues: [{ id: 1, startTime: 1, endTime: 4, text: '日本語' }],
    });
    video.currentTime = 2;
    video.dispatchEvent(new Event('seeked'));
    expect(root.querySelector('.japanese-subtitle')?.textContent).toBe('日本語');
    await dispatch({ type: 'CLEAR', epoch: 6 });
    expect(root.querySelector('.primary-subtitle')?.textContent).toBe('');
    expect(root.querySelector('.japanese-subtitle')?.textContent).toBe('');
    expect(
      await dispatch({
        type: 'JAPANESE_CUES',
        epoch: 5,
        cues: [{ id: 1, startTime: 1, endTime: 4, text: 'obsolete' }],
      }),
    ).toMatchObject({ ok: false });
    await dispatch({
      type: 'APPLY',
      epoch: 6,
      cues: [{ id: 1, startTime: 1, endTime: 4, text: '새 회차' }],
    });
    expect(root.querySelector('.primary-subtitle')?.textContent).toBe('새 회차');
    expect(root.querySelector('.japanese-subtitle')?.textContent).toBe('');
  });
  it('pauses only for bootstrap and resumes an originally playing video when the first chunk is available', async () => {
    playing = true;
    await dispatch({ type: 'PREPARE', epoch: 1, immediatePlayback: false, sourceLanguage: 'en' });
    expect(pause).toHaveBeenCalledTimes(1);
    await dispatch({
      type: 'APPEND',
      epoch: 1,
      cues: [{ id: 4, startTime: 1, endTime: 4, text: '첫 번역' }],
    });
    video.currentTime = 2;
    video.dispatchEvent(new Event('timeupdate'));
    expect(root.querySelector('span')?.textContent).toBe('첫 번역');
    await dispatch({ type: 'BOOTSTRAP_READY', epoch: 1 });
    expect(play).toHaveBeenCalledTimes(1);
    expect(video.paused).toBe(false);
    // Subsequent translation does not pause or gate playback.
    await dispatch({
      type: 'APPEND',
      epoch: 1,
      cues: [{ id: 25, startTime: 80, endTime: 82, text: '다음 번역' }],
    });
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it('preserves initially paused playback and an explicit user pause during preparation', async () => {
    await dispatch({ type: 'PREPARE', epoch: 1, immediatePlayback: false });
    await dispatch({ type: 'BOOTSTRAP_READY', epoch: 1 });
    expect(play).not.toHaveBeenCalled();
    playing = true;
    await dispatch({ type: 'PREPARE', epoch: 2, immediatePlayback: false });
    await video.play();
    video.pause();
    play.mockClear();
    await dispatch({ type: 'BOOTSTRAP_READY', epoch: 2 });
    expect(play).not.toHaveBeenCalled();
    expect(video.paused).toBe(true);
  });

  it('immediate playback never controls the video and reports seek priority plus periodic raw playback time', async () => {
    playing = true;
    await dispatch({ type: 'PREPARE', epoch: 3, immediatePlayback: true });
    await dispatch({ type: 'BUSY', busy: true });
    video.currentTime = 1080;
    video.dispatchEvent(new Event('seeking'));
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'PLAYBACK_STATE',
        epoch: 3,
        currentTime: 1080,
        seek: true,
        paused: false,
      }),
    );
    send.mockClear();
    await vi.advanceTimersByTimeAsync(1000);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'PLAYBACK_STATE', epoch: 3, currentTime: 1080, seek: false }),
    );
    expect(await dispatch({ type: 'PLAYBACK' })).toEqual({
      ok: true,
      currentTime: 1080,
      playbackTime: 1080,
      paused: false,
    });
    await dispatch({ type: 'BOOTSTRAP_READY', epoch: 3 });
    expect(pause).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
  });

  it('rejects stale chunks even when a frame probe was pending when the episode was cleared', async () => {
    let release: (value: unknown) => void = () => undefined;
    send.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = dispatch({
      type: 'APPEND',
      epoch: 5,
      cues: [{ id: 7, startTime: 0, endTime: 10, text: '이전 회차' }],
    });
    await dispatch({ type: 'CLEAR', epoch: 6 });
    release(null);
    expect(await pending).toEqual({ ok: false });
    expect(root.querySelector('span')).toBeNull();
    expect(
      await dispatch({
        type: 'APPEND',
        epoch: 5,
        cues: [{ id: 7, startTime: 0, endTime: 10, text: '이전 회차' }],
      }),
    ).toEqual({ ok: false });
    expect(root.querySelector('span')).toBeNull();
  });

  it('restores playback after cancellation and accepts a prepared snapshot without pausing a recreated frame', async () => {
    playing = true;
    await dispatch({ type: 'PREPARE', epoch: 7, immediatePlayback: false });
    await dispatch({ type: 'CLEAR', epoch: 8 });
    expect(play).toHaveBeenCalledTimes(1);
    pause.mockClear();
    await dispatch({
      type: 'APPLY',
      epoch: 8,
      immediatePlayback: true,
      bootstrapReady: true,
      cues: [{ id: 9, startTime: 0, endTime: 8, text: '현재 회차' }],
    });
    expect(root.querySelector('span')?.textContent).toBe('현재 회차');
    expect(pause).not.toHaveBeenCalled();
  });
  it('releases bootstrap preparation on terminal failure and continues reporting completed-episode playback', async () => {
    playing = true;
    await dispatch({ type: 'PREPARE', epoch: 9, immediatePlayback: false });
    await dispatch({ type: 'BUSY', busy: true });
    await dispatch({
      type: 'TRANSLATION_STATUS',
      epoch: 9,
      stage: 'partial',
      translation: {
        playbackTime: 0,
        translatedUntil: 90,
        bufferSeconds: 90,
        targetBufferSeconds: 300,
        completedChunks: 2,
        totalChunks: 3,
        failedChunks: 1,
        chunks: [],
      },
    });
    await dispatch({ type: 'BUSY', busy: false });
    expect(play).toHaveBeenCalledTimes(1);
    send.mockClear();
    video.currentTime = 81;
    await vi.advanceTimersByTimeAsync(1000);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'PLAYBACK_STATE', epoch: 9, currentTime: 81, paused: false }),
    );
  });

  it('does not resurrect a queued chunk after a same-epoch clear', async () => {
    let release: (value: unknown) => void = () => undefined;
    send.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = dispatch({
      type: 'APPEND',
      epoch: 10,
      cues: [{ id: 10, startTime: 0, endTime: 10, text: '취소 자막' }],
    });
    await dispatch({ type: 'CLEAR', epoch: 10 });
    release(null);
    expect(await pending).toEqual({ ok: false });
    expect(root.querySelector('span')).toBeNull();
  });
});
