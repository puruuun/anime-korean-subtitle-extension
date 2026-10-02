import { installBridgeListener, clearBridge } from './bridgeStore';
import { detectEmbedded } from './subtitleSources';
import { findVideo } from './videoDetector';
import { SubtitleRenderer, type DisplaySettings } from '../subtitle/SubtitleRenderer';
import type { SubtitleCue } from '../subtitle/SubtitleCue';
import type { TranslationBufferStatus } from '../translation/TranslationQueue';
import { adapterFor } from '../sites/adapter';
import { observeNavigation } from './navigationObserver';
import { EpisodeLifecycleManager } from './EpisodeLifecycleManager';
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
    clearRevision = 0,
    playerRevision = 0,
    lastProbeAt = 0,
    alive = true,
    busy = false,
    immediatePlayback = false,
    translationStatus: TranslationBufferStatus | undefined,
    translationStage: string | undefined,
    translationMessage: string | undefined;
  type Preparation = {
    epoch: number;
    video: HTMLVideoElement;
    wasPlaying: boolean;
    pausedByPreparation: boolean;
    expectedPause: boolean;
    userControlled: boolean;
  };
  let preparation: Preparation | undefined;
  const message = (m: unknown) => chrome.runtime.sendMessage(m).catch(() => null);
  function reportPlayback(seek: boolean) {
    if (!video || !Number.isFinite(video.currentTime)) return;
    void message({
      type: 'PLAYBACK_STATE',
      epoch,
      currentTime: video.currentTime,
      playbackTime: video.currentTime,
      seek,
      paused: video.paused,
    });
  }
  function finishPreparation(resume: boolean) {
    const previous = preparation;
    preparation = undefined;
    if (
      resume &&
      previous &&
      previous.video === video &&
      previous.wasPlaying &&
      previous.pausedByPreparation &&
      !previous.userControlled &&
      video?.paused
    )
      void video.play().catch(() => undefined);
  }
  function onVideoEvent(event: Event) {
    if (preparation?.video === video) {
      if (event.type === 'pause') {
        if (preparation.expectedPause) preparation.expectedPause = false;
        else preparation.userControlled = true;
      } else if (event.type === 'play') {
        preparation.expectedPause = false;
        preparation.userControlled = true;
      }
    }
    reportPlayback(event.type === 'seeking' || event.type === 'seeked');
  }
  const playbackEvents = ['seeking', 'seeked', 'play', 'pause', 'loadedmetadata'];
  function resetPlayer(resume: boolean) {
    clearRevision++;
    finishPreparation(resume);
    cues = [];
    translationStatus = undefined;
    translationStage = undefined;
    translationMessage = undefined;
    immediatePlayback = false;
    renderer?.setCues([]);
    renderer?.setImmediatePlayback(false);
    renderer?.setTranslationStatus();
  }
  function acceptEpoch(value: unknown) {
    const next = Number(value);
    if (!Number.isSafeInteger(next) || next < epoch) return false;
    if (next > epoch) {
      resetPlayer(true);
      epoch = next;
    }
    return true;
  }
  function configureRenderer() {
    renderer?.setCues(cues);
    renderer?.setOffset(offset);
    renderer?.setImmediatePlayback(immediatePlayback);
    renderer?.setTranslationStatus(translationStatus, translationStage, translationMessage);
    if (display) renderer?.setDisplay(display);
  }
  async function probe() {
    const next = findVideo();
    if (next !== video) {
      playerRevision++;
      lastProbeAt = 0;
      finishPreparation(false);
      if (video) for (const name of playbackEvents) video.removeEventListener(name, onVideoEvent);
      renderer?.destroy();
      video = next;
      renderer = video ? new SubtitleRenderer(video) : undefined;
      if (video) for (const name of playbackEvents) video.addEventListener(name, onVideoEvent);
      configureRenderer();
    }
    const r = video?.getBoundingClientRect();
    if (Date.now() - lastProbeAt >= 1000) {
      lastProbeAt = Date.now();
      await message({
        type: 'FRAME_READY',
        hasVideo: !!video,
        area: r ? r.width * r.height : 0,
        playerRevision,
      });
    }
  }
  const probeTimer = setInterval(() => {
    if (alive) void probe();
  }, 1500);
  void probe();
  const playbackTimer = setInterval(() => {
    if (alive && (busy || translationStatus)) reportPlayback(false);
  }, 1000);
  const heartbeat = setInterval(() => {
    if (busy) void message({ type: 'HEARTBEAT' });
  }, 15000);
  const lifecycle =
    window === window.top && adapterFor(location.href)
      ? new EpisodeLifecycleManager({
          url: () => location.href,
          detect: async () => {
            const adapter = adapterFor(location.href);
            if (!adapter) throw Error('지원하는 사이트가 아닙니다.');
            return adapter.getAnimeContext();
          },
          navigate: async () => {
            resetPlayer(true);
            clearBridge();
            busy = false;
            await message({ type: 'EPISODE_NAVIGATING' });
          },
          ready: async (context) => {
            await message({ type: 'EPISODE_READY', context });
          },
        })
      : undefined;
  const stopNavigation = observeNavigation(() => {
    void probe();
    void lifecycle?.check();
  });
  void lifecycle?.check();
  window.addEventListener('pagehide', () => {
    alive = false;
    clearInterval(probeTimer);
    clearInterval(playbackTimer);
    clearInterval(heartbeat);
    stopNavigation();
    lifecycle?.stop();
    finishPreparation(false);
    if (video) for (const name of playbackEvents) video.removeEventListener(name, onVideoEvent);
    renderer?.destroy();
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) location.reload();
  });
  chrome.runtime.onMessage.addListener((m, _s, reply) => {
    if (m.type === 'BUSY') {
      if (m.epoch !== undefined && !acceptEpoch(m.epoch)) {
        reply({ ok: false });
        return;
      }
      busy = !!m.busy;
      if (busy) reportPlayback(false);
      else finishPreparation(true);
      reply({ ok: true });
    }
    if (m.type === 'FRAME_PROBE') {
      void probe().then(() => reply({ ok: true, video: !!video }));
      return true;
    }
    if (m.type === 'PLAYBACK') {
      reply({
        ok: !!video,
        currentTime: video?.currentTime ?? 0,
        playbackTime: video?.currentTime ?? 0,
        paused: video?.paused ?? true,
      });
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
    if (m.type === 'PREPARE') {
      if (!acceptEpoch(m.epoch)) {
        reply({ ok: false });
        return;
      }
      immediatePlayback = !!m.immediatePlayback;
      renderer?.setImmediatePlayback(immediatePlayback);
      if (!immediatePlayback && video && preparation?.epoch !== epoch) {
        const wasPlaying = !video.paused;
        preparation = {
          epoch,
          video,
          wasPlaying,
          pausedByPreparation: wasPlaying,
          expectedPause: wasPlaying,
          userControlled: false,
        };
        if (wasPlaying) video.pause();
      }
      reply({ ok: !!video });
    }
    if (m.type === 'BOOTSTRAP_READY') {
      if (!acceptEpoch(m.epoch)) {
        reply({ ok: false });
        return;
      }
      finishPreparation(true);
      reply({ ok: !!video });
    }
    if (m.type === 'APPLY' || m.type === 'APPEND') {
      if (!acceptEpoch(m.epoch)) {
        reply({ ok: false });
        return;
      }
      const appliedEpoch = epoch;
      const appliedRevision = clearRevision;
      if (m.type === 'APPLY') cues = [...m.cues];
      else {
        const store = new Map(cues.map((cue) => [cue.id, cue]));
        for (const cue of m.cues as SubtitleCue[]) store.set(cue.id, cue);
        cues = [...store.values()].sort((a, b) => a.startTime - b.startTime || a.id - b.id);
      }
      display = m.display ?? display;
      offset = m.offset ?? offset;
      if (typeof m.immediatePlayback === 'boolean') immediatePlayback = m.immediatePlayback;
      if (m.bootstrapReady) finishPreparation(true);
      void probe().then(() => {
        if (!alive || appliedEpoch !== epoch || appliedRevision !== clearRevision) {
          reply({ ok: false });
          return;
        }
        if (m.type === 'APPEND') renderer?.addCues(m.cues);
        else renderer?.setCues(cues);
        renderer?.setOffset(offset);
        renderer?.setImmediatePlayback(immediatePlayback);
        if (display) renderer?.setDisplay(display);
        reply({ ok: !!video });
      });
      return true;
    }
    if (m.type === 'TRANSLATION_STATUS') {
      if (!acceptEpoch(m.epoch)) {
        reply({ ok: false });
        return;
      }
      translationStatus = m.translation;
      translationStage = m.stage;
      translationMessage = m.message;
      renderer?.setTranslationStatus(translationStatus, translationStage, translationMessage);
      reply({ ok: !!video });
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
      if (acceptEpoch(m.epoch)) resetPlayer(true);
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
