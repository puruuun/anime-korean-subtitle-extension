import { installBridgeListener, clearBridge } from './bridgeStore';
import { detectEmbedded } from './subtitleSources';
import { findVideo } from './videoDetector';
import { SubtitleRenderer, type DisplaySettings } from '../subtitle/SubtitleRenderer';
import type { SubtitleCue } from '../subtitle/SubtitleCue';
import { adapterFor } from '../sites/adapter';
import { observeNavigation } from './navigationObserver';
import { normalizeTitle } from '../anime/titleNormalizer';
declare global {
  interface Window {
    __animeSubIsolatedV1?: boolean;
  }
}
if (!window.__animeSubIsolatedV1) {
  window.__animeSubIsolatedV1 = true;
  installBridgeListener();
  let renderer: SubtitleRenderer | undefined,
    video: HTMLVideoElement | null = null,
    cues: SubtitleCue[] = [],
    display: DisplaySettings | undefined,
    offset = 0,
    epoch = 0,
    lastIdentity = '',
    lastUrl = location.href,
    alive = true,
    busy = false;
  const message = (m: unknown) => chrome.runtime.sendMessage(m).catch(() => null);
  async function probe() {
    const next = findVideo();
    if (next !== video) {
      renderer?.destroy();
      video = next;
      renderer = video ? new SubtitleRenderer(video) : undefined;
      renderer?.setCues(cues);
      renderer?.setOffset(offset);
      if (display) renderer?.setDisplay(display);
    }
    const r = video?.getBoundingClientRect();
    await message({ type: 'FRAME_READY', hasVideo: !!video, area: r ? r.width * r.height : 0 });
  }
  const probeTimer = setInterval(() => {
    if (alive) void probe();
  }, 1500);
  void probe();
  const heartbeat = setInterval(() => {
    if (busy) void message({ type: 'HEARTBEAT' });
  }, 15000);
  async function checkContext() {
    if (window !== window.top) return;
    const a = adapterFor(location.href);
    if (!a) return;
    try {
      const context = await a.getAnimeContext();
      const identity = JSON.stringify([
        new URL(context.pageUrl).pathname,
        context.episode,
        normalizeTitle(context.title),
      ]);
      if (lastIdentity && identity !== lastIdentity) {
        cues = [];
        renderer?.setCues([]);
        clearBridge();
        busy = false;
        await message({ type: 'CONTEXT_CHANGED' });
      }
      lastIdentity = identity;
    } catch {
      if (location.href !== lastUrl) {
        cues = [];
        renderer?.setCues([]);
        clearBridge();
        busy = false;
        await message({ type: 'CONTEXT_CHANGED' });
        lastIdentity = '';
      }
    }
    lastUrl = location.href;
  }
  observeNavigation(() => {
    void checkContext();
  });
  void checkContext();
  window.addEventListener('pagehide', () => {
    alive = false;
    clearInterval(probeTimer);
    clearInterval(heartbeat);
    renderer?.destroy();
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) location.reload();
  });
  chrome.runtime.onMessage.addListener((m, _s, reply) => {
    if (m.type === 'BUSY') {
      busy = !!m.busy;
      reply({ ok: true });
    }
    if (m.type === 'FRAME_PROBE') {
      void probe().then(() => reply({ ok: true, video: !!video }));
      return true;
    }
    if (m.type === 'SOURCES') {
      detectEmbedded().then(
        (sources) => reply({ ok: true, sources }),
        () => reply({ ok: false, sources: [] }),
      );
      return true;
    }
    if (m.type === 'CONTEXT') {
      const a = adapterFor(location.href);
      if (!a) {
        reply({ ok: false, error: '지원하는 사이트가 아닙니다.' });
        return;
      }
      a.getAnimeContext().then(
        (context) => reply({ ok: true, context }),
        (e) => reply({ ok: false, error: e.message }),
      );
      return true;
    }
    if (m.type === 'APPLY') {
      if (Number(m.epoch) < epoch) {
        reply({ ok: false });
        return;
      }
      epoch = m.epoch;
      cues = m.cues;
      display = m.display;
      offset = m.offset ?? offset;
      void probe().then(() => {
        renderer?.setCues(cues);
        renderer?.setOffset(offset);
        if (display) renderer?.setDisplay(display);
        reply({ ok: !!video });
      });
      return true;
    }
    if (m.type === 'OFFSET') {
      offset = m.offset;
      renderer?.setOffset(offset);
      reply({ ok: true });
    }
    if (m.type === 'DISPLAY') {
      display = m.display;
      if (display) renderer?.setDisplay(display);
      reply({ ok: true });
    }
    if (m.type === 'CLEAR') {
      if (Number(m.epoch) >= epoch) {
        epoch = m.epoch;
        cues = [];
        renderer?.setCues([]);
      }
      reply({ ok: true });
    }
    if (m.type === 'DEMO') {
      if (video)
        renderer?.setCues([
          {
            id: 1,
            startTime: video.currentTime,
            endTime: video.currentTime + 8,
            text: '한국어 자막 렌더러 테스트',
          },
        ]);
      reply({ ok: !!video });
    }
  });
}
