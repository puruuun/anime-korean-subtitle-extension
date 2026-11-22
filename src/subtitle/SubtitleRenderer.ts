import type { SubtitleCue } from './SubtitleCue';
import type { TranslationBufferStatus } from '../translation/TranslationQueue';
export interface DisplaySettings {
  fontSize: number;
  bottom: number;
  backgroundOpacity: number;
  outline: number;
  maxLines: number;
  showJapanese: boolean;
  japaneseFontSize: number;
  japaneseOffset: number;
}
export const defaultDisplay: DisplaySettings = {
  fontSize: 28,
  bottom: 8,
  backgroundOpacity: 0.55,
  outline: 2,
  maxLines: 3,
  showJapanese: false,
  japaneseFontSize: 22,
  japaneseOffset: 0,
};
export function activeAt(cues: SubtitleCue[], t: number): SubtitleCue[] {
  const len = cues.length;
  if (len === 0) return [];
  let low = 0;
  let high = len - 1;
  let lastMatch = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (cues[mid].startTime <= t) {
      lastMatch = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  if (lastMatch === -1) return [];
  const active: SubtitleCue[] = [];
  for (let i = 0; i <= lastMatch; i++) {
    const c = cues[i];
    if (t < c.endTime) {
      active.push(c);
    }
  }
  return active;
}
export function buildNativeTimelineCues(
  primary: SubtitleCue[],
  japanese: SubtitleCue[],
  opts: {
    offset: number;
    showJapanese: boolean;
    japaneseOffset: number;
    maxLines: number;
  },
): Array<{ startTime: number; endTime: number; text: string }> {
  const shift = (cues: SubtitleCue[], delta: number) =>
    cues.flatMap((c) => {
      const startTime = Math.max(0, c.startTime - delta);
      const endTime = c.endTime - delta;
      return endTime > startTime && endTime > 0 ? [{ startTime, endTime, text: c.text }] : [];
    });
  const shiftedPrimary = shift(primary, opts.offset);
  const shiftedJapanese = opts.showJapanese
    ? shift(japanese, opts.offset + opts.japaneseOffset)
    : [];
  const boundaries = new Set<number>();
  for (const c of shiftedPrimary) {
    boundaries.add(c.startTime);
    boundaries.add(c.endTime);
  }
  for (const c of shiftedJapanese) {
    boundaries.add(c.startTime);
    boundaries.add(c.endTime);
  }
  const sorted = [...boundaries].sort((a, b) => a - b);
  const maxLines = Math.max(0, opts.maxLines);
  const result: Array<{ startTime: number; endTime: number; text: string }> = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const t0 = sorted[i];
    const t1 = sorted[i + 1];
    if (t1 <= t0) continue;
    const mid = (t0 + t1) / 2;
    const primaryText = shiftedPrimary
      .filter((c) => c.startTime <= mid && mid < c.endTime)
      .map((c) => c.text)
      .join('\n')
      .split('\n')
      .slice(0, maxLines)
      .join('\n');
    const japaneseText = opts.showJapanese
      ? shiftedJapanese
          .filter((c) => c.startTime <= mid && mid < c.endTime)
          .map((c) => c.text)
          .join('\n')
          .split('\n')
          .slice(0, maxLines)
          .join('\n')
      : '';
    const text = [primaryText, japaneseText].filter(Boolean).join('\n');
    if (!text) continue;
    const prev = result[result.length - 1];
    if (prev && prev.text === text && Math.abs(prev.endTime - t0) < 1e-6) {
      prev.endTime = t1;
    } else {
      result.push({ startTime: t0, endTime: t1, text });
    }
  }
  return result;
}
function timeLabel(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  return (
    Math.floor(total / 60)
      .toString()
      .padStart(2, '0') +
    ':' +
    (total % 60).toString().padStart(2, '0')
  );
}
export class SubtitleRenderer {
  private cueStore = new Map<number, SubtitleCue>();
  private cues: SubtitleCue[] = [];
  private japaneseCues: SubtitleCue[] = [];
  private offset = 0;
  private host = document.createElement('div');
  private line = document.createElement('div');
  private primaryLine = document.createElement('div');
  private japaneseLine = document.createElement('div');
  private statusLine = document.createElement('div');
  private raf = 0;
  private frame: number | undefined;
  private disposed = false;
  private display = defaultDisplay;
  private last = '';
  private lastRect = '';
  private immediatePlayback = false;
  private originalTrackModes = new Map<TextTrack, TextTrackMode>();
  private translationStatus: TranslationBufferStatus | undefined;
  private translationStage: string | undefined;
  private translationMessage: string | undefined;
  constructor(private video: HTMLVideoElement) {
    this.host.dataset.animesubOverlay = 'true';
    this.line.className = 'subtitle';
    this.primaryLine.className = 'primary-subtitle';
    this.japaneseLine.className = 'japanese-subtitle';
    this.line.append(this.primaryLine, this.japaneseLine);
    this.statusLine.className = 'translation-status';
    this.statusLine.hidden = true;
    const shadow = this.host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent =
      ':host{pointer-events:none!important;z-index:2147483647!important;position:fixed!important;display:block!important}.subtitle{position:absolute;left:4%;right:4%;text-align:center;white-space:pre-line;font-family:Arial,"Noto Sans KR","Noto Sans JP",sans-serif;color:white;line-height:1.35;}.primary-subtitle,.japanese-subtitle{overflow:hidden}.japanese-subtitle{color:#d7e7ff;margin-top:6px}span{box-decoration-break:clone;-webkit-box-decoration-break:clone;padding:3px 9px;border-radius:5px}.translation-status{position:absolute;top:10px;right:10px;max-width:90%;padding:6px 9px;border-radius:6px;background:rgba(0,0,0,.65);color:#fff;font:12px/1.5 Arial,"Noto Sans KR",sans-serif;white-space:pre-line;}';
    shadow.append(style, this.line, this.statusLine);
    video.textTracks?.addEventListener?.('addtrack', this.render);
    this.relocate();
    this.setDisplay(defaultDisplay);
    for (const name of [
      'timeupdate',
      'seeked',
      'seeking',
      'pause',
      'play',
      'ratechange',
      'loadedmetadata',
    ])
      video.addEventListener(name, this.render);
    for (const name of [
      'webkitbeginfullscreen',
      'webkitendfullscreen',
      'webkitpresentationmodechanged',
    ])
      video.addEventListener(name, this.relocate);
    document.addEventListener('fullscreenchange', this.relocate);
    window.addEventListener('resize', this.render);
    window.addEventListener('scroll', this.render, true);
    this.tick();
  }
  setCues(cues: SubtitleCue[]) {
    this.cueStore.clear();
    this.addCues(cues);
  }
  addCues(cues: SubtitleCue[]) {
    for (const cue of cues) this.cueStore.set(cue.id, { ...cue });
    this.cues = [...this.cueStore.values()].sort(
      (a, b) => a.startTime - b.startTime || a.id - b.id,
    );
    this.nativeRevision++;
    this.render();
  }
  setJapaneseCues(cues: SubtitleCue[]) {
    this.japaneseCues = cues
      .map((c) => ({ ...c }))
      .sort((a, b) => a.startTime - b.startTime || a.id - b.id);
    this.last = '';
    this.nativeRevision++;
    this.render();
  }
  setImmediatePlayback(immediate: boolean) {
    this.immediatePlayback = immediate;
    this.render();
  }
  setTranslationStatus(status?: TranslationBufferStatus, stage?: string, message?: string) {
    this.translationStatus = status;
    this.translationStage = stage;
    this.translationMessage = message;
    this.renderStatus();
  }
  setOffset(offset: number) {
    const next = Math.max(-10, Math.min(10, offset));
    if (next !== this.offset) this.nativeRevision++;
    this.offset = next;
    this.render();
  }
  setDisplay(display: DisplaySettings) {
    display = { ...defaultDisplay, ...display };
    if (
      display.showJapanese !== this.display.showJapanese ||
      display.japaneseOffset !== this.display.japaneseOffset ||
      display.maxLines !== this.display.maxLines
    ) {
      this.nativeRevision++;
    }
    this.display = display;
    this.line.style.fontSize = display.fontSize + 'px';
    this.line.style.bottom = display.bottom + '%';
    this.line.style.textShadow = Array.from({ length: 8 }, (_, i) => {
      const a = (i * Math.PI) / 4;
      return Math.cos(a) * display.outline + 'px ' + Math.sin(a) * display.outline + 'px 1px #000';
    }).join(',');
    this.primaryLine.style.maxHeight = display.maxLines * 1.35 + 'em';
    this.japaneseLine.style.fontSize = display.japaneseFontSize + 'px';
    this.japaneseLine.style.maxHeight = display.maxLines * 1.35 + 'em';
    this.last = '';
    this.render();
  }
  private restoreTracks() {
    // Restore only modes that we changed. A later user track choice takes precedence.
    for (const [track, mode] of this.originalTrackModes)
      if (track.mode === 'hidden') track.mode = mode;
    this.originalTrackModes.clear();
  }
  private updateSourceTracks(hasOwnCue: boolean) {
    const hasTrack = this.cues.length || (this.display.showJapanese && this.japaneseCues.length);
    if (!hasTrack || (this.immediatePlayback && !hasOwnCue)) {
      this.restoreTracks();
      return;
    }
    for (const track of Array.from(this.video.textTracks ?? [])) {
      if (track === this.native || track.label === '한국어 · AnimeSub' || track.mode !== 'showing')
        continue;
      if (!this.originalTrackModes.has(track)) this.originalTrackModes.set(track, track.mode);
      track.mode = 'hidden';
    }
  }
  private renderStatus() {
    const status = this.translationStatus;
    this.statusLine.hidden = !status;
    if (!status) {
      this.statusLine.textContent = '';
      return;
    }
    const current = this.video.currentTime;
    const buffer = Math.max(0, Math.floor(status.bufferSeconds + status.playbackTime - current));
    const state =
      this.translationStage === 'error'
        ? this.translationMessage || '번역 실패'
        : this.translationStage === 'interrupted'
          ? '번역 중단'
          : this.translationStage === 'partial'
            ? '일부 번역 실패'
            : status.completedChunks === status.totalChunks
              ? '번역 완료'
              : status.failedChunks
                ? '일부 번역 실패 · 번역 중'
                : '번역 중';
    this.statusLine.textContent =
      state +
      '\n현재 재생: ' +
      timeLabel(current) +
      ' · 번역 완료: ' +
      timeLabel(status.translatedUntil) +
      '\nBuffer: ' +
      Math.floor(buffer / 60) +
      'm ' +
      (buffer % 60) +
      's';
  }
  private relocate = () => {
    this.lastRect = '';
    const full = document.fullscreenElement;
    (full && full !== this.video ? full : (document.body ?? document.documentElement)).append(
      this.host,
    );
    this.render();
  };
  private tick = () => {
    if (this.disposed) return;
    this.render();
    if (this.video.requestVideoFrameCallback && !this.video.paused)
      this.frame = this.video.requestVideoFrameCallback(this.tick);
    else this.raf = requestAnimationFrame(this.tick);
  };
  private native: TextTrack | undefined;
  private nativeCues: VTTCue[] = [];
  private nativeRevision = 0;
  private syncedNativeRevision = -1;
  isNativeVideoFullscreen(): boolean {
    const webkitVideo = this.video as HTMLVideoElement & {
      webkitDisplayingFullscreen?: boolean;
      webkitPresentationMode?: string;
    };
    return (
      document.fullscreenElement === this.video ||
      Boolean(webkitVideo.webkitDisplayingFullscreen) ||
      webkitVideo.webkitPresentationMode === 'fullscreen'
    );
  }
  private syncNativeTimeline(native: boolean) {
    if (!native) {
      if (this.native) this.native.mode = 'disabled';
      this.syncedNativeRevision = -1;
      return;
    }
    if (this.syncedNativeRevision === this.nativeRevision) return;
    if (!this.native) this.native = this.video.addTextTrack('subtitles', '한국어 · AnimeSub', 'ko');
    for (const c of this.nativeCues) this.native.removeCue(c);
    this.nativeCues = [];
    if (typeof VTTCue !== 'undefined') {
      const segments = buildNativeTimelineCues(this.cues, this.japaneseCues, {
        offset: this.offset,
        showJapanese: this.display.showJapanese,
        japaneseOffset: this.display.japaneseOffset,
        maxLines: this.display.maxLines,
      });
      for (const seg of segments) {
        const cue = new VTTCue(seg.startTime, seg.endTime, seg.text);
        this.nativeCues.push(cue);
        this.native.addCue(cue);
      }
    }
    this.native.mode = this.nativeCues.length ? 'showing' : 'disabled';
    this.syncedNativeRevision = this.nativeRevision;
  }
  private render = () => {
    if (this.disposed) return;
    const r = this.video.getBoundingClientRect();
    const rectKey = `${r.left},${r.top},${r.width},${r.height}`;
    if (rectKey !== this.lastRect) {
      this.lastRect = rectKey;
      this.host.style.left = r.left + 'px';
      this.host.style.top = r.top + 'px';
      this.host.style.width = r.width + 'px';
      this.host.style.height = r.height + 'px';
    }
    const t = this.video.currentTime + this.offset;
    const active = activeAt(this.cues, t);
    const jt = t + this.display.japaneseOffset;
    const japanese = this.display.showJapanese ? activeAt(this.japaneseCues, jt) : [];
    this.updateSourceTracks(active.length > 0 || japanese.length > 0);
    this.renderStatus();
    const text = active
      .map((c) => c.text)
      .join('\n')
      .split('\n')
      .slice(0, this.display.maxLines)
      .join('\n');
    const japaneseText = japanese
      .map((c) => c.text)
      .join('\n')
      .split('\n')
      .slice(0, this.display.maxLines)
      .join('\n');
    const native = this.isNativeVideoFullscreen();
    this.host.style.visibility = native || r.width === 0 ? 'hidden' : 'visible';
    this.syncNativeTimeline(native);
    // Include IDs and timing: equal dialogue text can occur in consecutive cues.
    const key =
      String(native) +
      this.offset +
      JSON.stringify(active.map((c) => [c.id, c.startTime, c.endTime])) +
      JSON.stringify(japanese.map((c) => [c.id, c.startTime, c.endTime])) +
      text +
      '\u0000' +
      japaneseText;
    if (key !== this.last) {
      this.last = key;
      for (const [line, content] of [
        [this.primaryLine, text],
        [this.japaneseLine, japaneseText],
      ] as const) {
        line.replaceChildren();
        line.hidden = !content;
        if (!content) continue;
        const span = document.createElement('span');
        span.textContent = content;
        span.style.background = 'rgba(0,0,0,' + this.display.backgroundOpacity + ')';
        line.append(span);
      }
    }
  };
  destroy() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    if (this.frame !== undefined) this.video.cancelVideoFrameCallback?.(this.frame);
    for (const n of [
      'timeupdate',
      'seeked',
      'seeking',
      'pause',
      'play',
      'ratechange',
      'loadedmetadata',
    ])
      this.video.removeEventListener(n, this.render);
    for (const n of [
      'webkitbeginfullscreen',
      'webkitendfullscreen',
      'webkitpresentationmodechanged',
    ])
      this.video.removeEventListener(n, this.relocate);
    this.video.textTracks?.removeEventListener?.('addtrack', this.render);
    document.removeEventListener('fullscreenchange', this.relocate);
    window.removeEventListener('resize', this.render);
    window.removeEventListener('scroll', this.render, true);
    if (this.native) {
      this.native.mode = 'disabled';
      for (const c of this.nativeCues) this.native.removeCue(c);
      this.nativeCues = [];
    }
    this.restoreTracks();
    this.originalTrackModes.clear();
    this.host.remove();
  }
}
