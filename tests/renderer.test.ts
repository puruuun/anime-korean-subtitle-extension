// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { SubtitleRenderer } from '../src/subtitle/SubtitleRenderer';
describe('renderer lifecycle', () => {
  it('renders currentTime, seeking, offset and pause; clears and destroys', () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
    document.body.innerHTML = '<div id="container"><video></video></div>';
    const v = document.querySelector('video')!;
    vi.spyOn(v, 'getBoundingClientRect').mockReturnValue({
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
      const el = original(tag, ...(args as []));
      const attach = el.attachShadow.bind(el);
      if (tag === 'div')
        vi.spyOn(el, 'attachShadow').mockImplementation(() => {
          captured = attach({ mode: 'open' });
          return captured;
        });
      return el;
    }) as typeof document.createElement);
    const r = new SubtitleRenderer(v);
    r.setCues([
      { id: 1, startTime: 1, endTime: 3, text: '안녕' },
      { id: 2, startTime: 6, endTime: 8, text: '다음' },
    ]);
    v.currentTime = 2;
    v.dispatchEvent(new Event('seeked'));
    expect(captured?.querySelector('span')?.textContent).toBe('안녕');
    v.currentTime = 7;
    v.dispatchEvent(new Event('seeking'));
    expect(captured?.querySelector('span')?.textContent).toBe('다음');
    r.setOffset(-5);
    expect(captured?.querySelector('span')?.textContent).toBe('안녕');
    v.dispatchEvent(new Event('pause'));
    r.setCues([]);
    expect(captured?.querySelector('span')).toBeNull();
    r.destroy();
    expect(document.querySelector('[data-animesub-overlay]')).toBeNull();
    vi.restoreAllMocks();
    raf.mockRestore();
  });
});
