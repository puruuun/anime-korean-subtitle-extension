// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { SubtitleRenderer, defaultDisplay, activeAt } from '../src/subtitle/SubtitleRenderer';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

function fixture(tracks: TextTrack[] = []) {
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
  document.body.innerHTML = '<div id="container"><video></video></div>';
  const video = document.querySelector('video')!;
  Object.defineProperty(video, 'textTracks', { value: tracks, configurable: true });
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
  const original = document.createElement.bind(document);
  let captured: ShadowRoot | undefined;
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string, ...args: unknown[]) => {
    const element = original(tag, ...(args as []));
    if (tag === 'div') {
      const attach = element.attachShadow.bind(element);
      vi.spyOn(element, 'attachShadow').mockImplementation(() => {
        captured = attach({ mode: 'open' });
        return captured;
      });
    }
    return element;
  }) as typeof document.createElement);
  const renderer = new SubtitleRenderer(video);
  return { renderer, video, root: () => captured! };
}

describe('renderer lifecycle', () => {
  it('hides duplicate site tracks while only original Japanese is ready, then restores them when switched off', () => {
    const english = { label: 'English', mode: 'showing' } as TextTrack;
    const { renderer, video } = fixture([english]);
    renderer.setImmediatePlayback(true);
    renderer.setJapaneseCues([{ id: 1, startTime: 1, endTime: 4, text: '日本語' }]);
    video.currentTime = 2;
    renderer.setDisplay({ ...defaultDisplay, showJapanese: true });
    expect(english.mode).toBe('hidden');
    renderer.setDisplay(defaultDisplay);
    expect(english.mode).toBe('showing');
    renderer.destroy();
  });
  it('renders independent Korean/Japanese timings, offset, font and live on/off without ID collisions', () => {
    const { renderer, video, root } = fixture();
    renderer.setCues([{ id: 1, startTime: 1, endTime: 6, text: '한국어' }]);
    renderer.setJapaneseCues([{ id: 1, startTime: 2, endTime: 4, text: '日本語' }]);
    video.currentTime = 3;
    video.dispatchEvent(new Event('seeked'));
    expect(root().querySelector('.japanese-subtitle')?.textContent).toBe('');
    renderer.setDisplay({ ...defaultDisplay, showJapanese: true, japaneseFontSize: 20 });
    expect(root().querySelector('.primary-subtitle')?.textContent).toBe('한국어');
    expect(root().querySelector('.japanese-subtitle')?.textContent).toBe('日本語');
    expect((root().querySelector('.japanese-subtitle') as HTMLElement).style.fontSize).toBe('20px');
    video.currentTime = 4.5;
    video.dispatchEvent(new Event('seeked'));
    expect(root().querySelector('.primary-subtitle')?.textContent).toBe('한국어');
    expect(root().querySelector('.japanese-subtitle')?.textContent).toBe('');
    renderer.setDisplay({ ...defaultDisplay, showJapanese: true, japaneseOffset: -2 });
    expect(root().querySelector('.japanese-subtitle')?.textContent).toBe('日本語');
    renderer.setDisplay(defaultDisplay);
    expect(root().querySelector('.primary-subtitle')?.textContent).toBe('한국어');
    expect(root().querySelector('.japanese-subtitle')?.textContent).toBe('');
    renderer.destroy();
  });
  it('keeps both languages in a native track for video-element fullscreen and clears it on exit', () => {
    const { renderer, video } = fixture();
    const native = {
      mode: 'disabled',
      addCue: vi.fn(),
      removeCue: vi.fn(),
    } as unknown as TextTrack;
    vi.spyOn(video, 'addTextTrack').mockReturnValue(native);
    vi.stubGlobal(
      'VTTCue',
      class {
        constructor(
          public startTime: number,
          public endTime: number,
          public text: string,
        ) {}
      },
    );
    renderer.setCues([{ id: 1, startTime: 1, endTime: 6, text: '한국어' }]);
    renderer.setJapaneseCues([{ id: 2, startTime: 2, endTime: 4, text: '日本語' }]);
    renderer.setDisplay({ ...defaultDisplay, showJapanese: true });
    video.currentTime = 3;
    Object.defineProperty(document, 'fullscreenElement', { value: video, configurable: true });
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(native.addCue).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: '한국어\n日本語', startTime: 2, endTime: 4 }),
    );
    expect(native.mode).toBe('showing');
    Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(native.mode).toBe('disabled');
    renderer.destroy();
    vi.unstubAllGlobals();
  });
  it('renders currentTime, seeking, offset and pause; clears and destroys', () => {
    const { renderer, video, root } = fixture();
    renderer.setCues([
      { id: 1, startTime: 1, endTime: 3, text: '안녕' },
      { id: 2, startTime: 6, endTime: 8, text: '다음' },
    ]);
    video.currentTime = 2;
    video.dispatchEvent(new Event('seeked'));
    expect(root().querySelector('span')?.textContent).toBe('안녕');
    video.currentTime = 7;
    video.dispatchEvent(new Event('seeking'));
    expect(root().querySelector('span')?.textContent).toBe('다음');
    renderer.setOffset(-5);
    expect(root().querySelector('span')?.textContent).toBe('안녕');
    video.dispatchEvent(new Event('pause'));
    renderer.setCues([]);
    expect(root().querySelector('span')).toBeNull();
    renderer.destroy();
    expect(document.querySelector('[data-animesub-overlay]')).toBeNull();
  });

  it('makes chunks available immediately when they arrive out of order, without changing timing or duplicating IDs', () => {
    const { renderer, video, root } = fixture();
    const late = { id: 42, startTime: 100, endTime: 103, text: '나중 자막' };
    renderer.addCues([late]);
    video.currentTime = 101;
    video.dispatchEvent(new Event('timeupdate'));
    expect(root().querySelector('span')?.textContent).toBe('나중 자막');
    renderer.addCues([{ id: 2, startTime: 2, endTime: 4, text: '첫 자막' }]);
    video.currentTime = 3;
    video.dispatchEvent(new Event('seeked'));
    expect(root().querySelector('span')?.textContent).toBe('첫 자막');
    renderer.addCues([{ ...late, text: '업데이트 자막' }]);
    video.currentTime = 101;
    video.dispatchEvent(new Event('seeked'));
    expect(root().querySelector('span')?.textContent).toBe('업데이트 자막');
    video.currentTime = 103;
    video.dispatchEvent(new Event('timeupdate'));
    expect(root().querySelector('span')).toBeNull();
    expect(late).toEqual({ id: 42, startTime: 100, endTime: 103, text: '나중 자막' });
    renderer.destroy();
  });

  it('restores original native tracks in immediate playback gaps, on clear and on destroy', () => {
    const english = { label: 'English', mode: 'showing' } as TextTrack;
    const disabled = { label: 'Spanish', mode: 'disabled' } as TextTrack;
    const own = { label: '한국어 · AnimeSub', mode: 'disabled' } as TextTrack;
    const { renderer, video, root } = fixture([english, disabled, own]);
    renderer.setImmediatePlayback(true);
    renderer.addCues([{ id: 8, startTime: 8, endTime: 10, text: '준비된 한국어' }]);
    expect(english.mode).toBe('showing');
    video.currentTime = 9;
    video.dispatchEvent(new Event('seeked'));
    expect(english.mode).toBe('hidden');
    expect(root().querySelector('span')?.textContent).toBe('준비된 한국어');
    video.currentTime = 20;
    video.dispatchEvent(new Event('seeked'));
    expect(english.mode).toBe('showing');
    expect(disabled.mode).toBe('disabled');
    renderer.setImmediatePlayback(false);
    expect(english.mode).toBe('hidden');
    renderer.setCues([]);
    expect(english.mode).toBe('showing');
    renderer.addCues([{ id: 8, startTime: 8, endTime: 10, text: '준비된 한국어' }]);
    renderer.destroy();
    expect(english.mode).toBe('showing');
    expect(own.mode).toBe('disabled');
  });

  it('shows live buffer status separately from subtitle lines and relocates into the fullscreen player', () => {
    const { renderer, video, root } = fixture();
    video.currentTime = 201;
    renderer.setTranslationStatus({
      playbackTime: 201,
      translatedUntil: 708,
      bufferSeconds: 507,
      targetBufferSeconds: 300,
      completedChunks: 2,
      totalChunks: 5,
      failedChunks: 0,
      chunks: [],
    });
    const line = root().querySelector('.translation-status')!;
    expect(line.textContent).toContain('번역 중');
    expect(line.textContent).toContain('현재 재생: 03:21');
    expect(line.textContent).toContain('번역 완료: 11:48');
    expect(line.textContent).toContain('Buffer: 8m 27s');
    expect(root().querySelector('.subtitle')?.textContent).toBe('');
    video.currentTime = 211;
    video.dispatchEvent(new Event('timeupdate'));
    expect(line.textContent).toContain('Buffer: 8m 17s');
    const container = document.getElementById('container')!;
    Object.defineProperty(document, 'fullscreenElement', {
      value: container,
      writable: true,
      configurable: true,
    });
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(container.querySelector('[data-animesub-overlay]')).not.toBeNull();
    Object.defineProperty(document, 'fullscreenElement', {
      value: null,
      writable: true,
      configurable: true,
    });
    renderer.setTranslationStatus();
    expect((line as HTMLElement).hidden).toBe(true);
    renderer.destroy();
  });
  it('keeps subtitle choices made after renderer creation and restores only tracks it hid', () => {
    const english = { label: 'English', mode: 'disabled' } as TextTrack;
    const spanish = { label: 'Spanish', mode: 'disabled' } as TextTrack;
    const { renderer, video } = fixture([english, spanish]);
    english.mode = 'showing';
    video.dispatchEvent(new Event('timeupdate'));
    expect(english.mode).toBe('showing');
    renderer.setImmediatePlayback(true);
    renderer.addCues([{ id: 3, startTime: 3, endTime: 5, text: '한국어' }]);
    expect(english.mode).toBe('showing');
    video.currentTime = 4;
    video.dispatchEvent(new Event('seeked'));
    expect(english.mode).toBe('hidden');
    // The user's explicit disabled choice must not be overwritten when coverage ends.
    english.mode = 'disabled';
    video.currentTime = 10;
    video.dispatchEvent(new Event('seeked'));
    expect(english.mode).toBe('disabled');
    spanish.mode = 'showing';
    video.dispatchEvent(new Event('timeupdate'));
    expect(spanish.mode).toBe('showing');
    video.currentTime = 4;
    video.dispatchEvent(new Event('seeked'));
    expect(spanish.mode).toBe('hidden');
    renderer.setCues([]);
    expect(spanish.mode).toBe('showing');
    expect(english.mode).toBe('disabled');
    renderer.destroy();
  });

  it('uses terminal status labels after partial failure or interruption', () => {
    const { renderer, root } = fixture();
    const status = {
      playbackTime: 0,
      translatedUntil: 90,
      bufferSeconds: 90,
      targetBufferSeconds: 300,
      completedChunks: 2,
      totalChunks: 3,
      failedChunks: 1,
      chunks: [],
    };
    renderer.setTranslationStatus(status, 'partial');
    expect(root().querySelector('.translation-status')?.textContent).toContain('일부 번역 실패');
    expect(root().querySelector('.translation-status')?.textContent).not.toContain('번역 중');
    renderer.setTranslationStatus(status, 'interrupted');
    expect(root().querySelector('.translation-status')?.textContent).toContain('번역 중단');
    renderer.destroy();
  });
  it('optimizes active cue lookup with binary search (activeAt) over 1000 cues and handles overlapping intervals', () => {
    const cues = Array.from({ length: 1000 }, (_, i) => ({
      id: i + 1,
      startTime: i * 2,
      endTime: i * 2 + 3,
      text: `자막 ${i + 1}`,
    }));

    // Before any cue starts
    expect(activeAt(cues, -1)).toEqual([]);

    // Single active cue at t = 21 (cue 11: 20..23, cue 12: 22..25)
    const single = activeAt(cues, 21);
    expect(single.map((c) => c.id)).toEqual([11]);

    // Overlapping active cues at t = 22.5 (cue 11: 20..23, cue 12: 22..25)
    const overlapping = activeAt(cues, 22.5);
    expect(overlapping.map((c) => c.id)).toEqual([11, 12]);

    // After all cues have ended
    expect(activeAt(cues, 5000)).toEqual([]);

    // Verify integration with SubtitleRenderer
    const { renderer, video, root } = fixture();
    renderer.setCues(cues);
    video.currentTime = 22.5;
    video.dispatchEvent(new Event('seeked'));
    expect(root().querySelector('.primary-subtitle')?.textContent).toBe('자막 11\n자막 12');

    video.currentTime = 21;
    video.dispatchEvent(new Event('seeked'));
    expect(root().querySelector('.primary-subtitle')?.textContent).toBe('자막 11');
    renderer.destroy();
  });

  it('skips redundant DOM style updates when getBoundingClientRect is unchanged and updates immediately on rect change', () => {
    let rect = {
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 640,
      bottom: 360,
      width: 640,
      height: 360,
      toJSON() {},
    };
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
    document.body.innerHTML = '<video></video>';
    const video = document.querySelector('video')!;
    vi.spyOn(video, 'getBoundingClientRect').mockImplementation(() => rect);

    let hostElement: HTMLElement | undefined;
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string, ...args: unknown[]) => {
      const el = originalCreateElement(tag, ...(args as []));
      if (tag === 'div' && !hostElement) {
        hostElement = el;
      }
      return el;
    }) as typeof document.createElement);

    const renderer = new SubtitleRenderer(video);
    expect(hostElement).toBeDefined();
    expect(hostElement!.style.width).toBe('640px');
    expect(hostElement!.style.height).toBe('360px');

    const styleSpy = vi.spyOn(hostElement!.style, 'left', 'set');

    // Trigger timeupdate with same rect: should not update host style
    video.dispatchEvent(new Event('timeupdate'));
    expect(styleSpy).not.toHaveBeenCalled();

    // Change rect: should update host style
    rect = {
      x: 50,
      y: 60,
      left: 50,
      top: 60,
      right: 850,
      bottom: 510,
      width: 800,
      height: 450,
      toJSON() {},
    };
    window.dispatchEvent(new Event('resize'));
    expect(styleSpy).toHaveBeenCalledWith('50px');
    expect(hostElement!.style.left).toBe('50px');
    expect(hostElement!.style.top).toBe('60px');
    expect(hostElement!.style.width).toBe('800px');
    expect(hostElement!.style.height).toBe('450px');

    // Relocating should reset lastRect and re-apply styles on next render
    styleSpy.mockClear();
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(styleSpy).toHaveBeenCalledWith('50px');

    renderer.destroy();
  });
});
