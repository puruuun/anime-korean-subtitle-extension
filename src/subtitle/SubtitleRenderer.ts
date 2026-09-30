import type { SubtitleCue } from './SubtitleCue';
import type { TranslationBufferStatus } from '../translation/TranslationQueue';
export interface DisplaySettings {
  fontSize: number;
  bottom: number;
  backgroundOpacity: number;
  outline: number;
  maxLines: number;
}
export const defaultDisplay: DisplaySettings = {
  fontSize: 28,
  bottom: 8,
  backgroundOpacity: 0.55,
  outline: 2,
  maxLines: 3,
};
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
  private offset = 0;
  private host = document.createElement('div');
  private line = document.createElement('div');
  private statusLine = document.createElement('div');
  private raf = 0;
  private frame: number | undefined;
  private disposed = false;
  private display = defaultDisplay;
  private last = '';
  private immediatePlayback = false;
  private originalTrackModes = new Map<TextTrack, TextTrackMode>();
  private translationStatus: TranslationBufferStatus | undefined;
  private translationStage: string | undefined;
  private translationMessage: string | undefined;
  constructor(private video: HTMLVideoElement) {
    this.host.dataset.animesubOverlay = 'true';
    this.line.className = 'subtitle';
    this.statusLine.className = 'translation-status';
    this.statusLine.hidden = true;
    const shadow = this.host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent =
      ':host{pointer-events:none!important;z-index:2147483647!important;position:fixed!important;display:block!important}.subtitle{position:absolute;left:4%;right:4%;text-align:center;white-space:pre-line;font-family:Arial,"Noto Sans KR",sans-serif;color:white;line-height:1.35;overflow:hidden;}span{box-decoration-break:clone;-webkit-box-decoration-break:clone;padding:3px 9px;border-radius:5px}.translation-status{position:absolute;top:10px;right:10px;max-width:90%;padding:6px 9px;border-radius:6px;background:rgba(0,0,0,.65);color:#fff;font:12px/1.5 Arial,"Noto Sans KR",sans-serif;white-space:pre-line;}';
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
    this.offset = Math.max(-10, Math.min(10, offset));
    this.render();
  }
  setDisplay(display: DisplaySettings) {
    this.display = display;
    this.line.style.fontSize = display.fontSize + 'px';
    this.line.style.bottom = display.bottom + '%';
    this.line.style.textShadow = Array.from({ length: 8 }, (_, i) => {
      const a = (i * Math.PI) / 4;
      return Math.cos(a) * display.outline + 'px ' + Math.sin(a) * display.outline + 'px 1px #000';
    }).join(',');
    this.line.style.maxHeight = display.maxLines * 1.35 + 'em';
    this.last = '';
    this.render();
  }
  private restoreTracks() {
    // Restore only modes that we changed. A later user track choice takes precedence.
    for (const [track, mode] of this.originalTrackModes)
      if (track.mode === 'hidden') track.mode = mode;
    this.originalTrackModes.clear();
  }
  private updateSourceTracks(hasKoreanCue: boolean) {
    if (!this.cues.length || (this.immediatePlayback && !hasKoreanCue)) {
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
  private syncNative(active: SubtitleCue[]) {
    if (!this.native) this.native = this.video.addTextTrack('subtitles', '한국어 · AnimeSub', 'ko');
    for (const c of this.nativeCues) this.native.removeCue(c);
    this.nativeCues = active.map((c) => {
      const start = Math.max(0, c.startTime - this.offset);
      const cue = new VTTCue(start, Math.max(start + 0.001, c.endTime - this.offset), c.text);
      cue.id = String(c.id);
      return cue;
    });
    this.nativeCues.forEach((c) => this.native!.addCue(c));
    this.native.mode = active.length ? 'showing' : 'disabled';
  }
  private render = () => {
    if (this.disposed) return;
    const r = this.video.getBoundingClientRect();
    this.host.style.left = r.left + 'px';
    this.host.style.top = r.top + 'px';
    this.host.style.width = r.width + 'px';
    this.host.style.height = r.height + 'px';
    const t = this.video.currentTime + this.offset;
    const active = this.cues.filter((c) => c.startTime <= t && t < c.endTime);
    this.updateSourceTracks(active.length > 0);
    this.renderStatus();
    const text = active
      .map((c) => c.text)
      .join('\n')
      .split('\n')
      .slice(0, this.display.maxLines)
      .join('\n');
    const native = document.fullscreenElement === this.video;
    this.host.style.visibility = native || r.width === 0 ? 'hidden' : 'visible';
    if (!native && this.native) this.native.mode = 'disabled';
    // Include IDs and timing: equal dialogue text can occur in consecutive cues.
    const key =
      String(native) +
      this.offset +
      JSON.stringify(active.map((c) => [c.id, c.startTime, c.endTime])) +
      text;
    if (key !== this.last) {
      this.last = key;
      this.line.replaceChildren();
      if (text) {
        const span = document.createElement('span');
        span.textContent = text;
        span.style.background = 'rgba(0,0,0,' + this.display.backgroundOpacity + ')';
        this.line.append(span);
      }
      if (native) this.syncNative(active);
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
    this.video.textTracks?.removeEventListener?.('addtrack', this.render);
    document.removeEventListener('fullscreenchange', this.relocate);
    window.removeEventListener('resize', this.render);
    window.removeEventListener('scroll', this.render, true);
    if (this.native) {
      this.native.mode = 'disabled';
      for (const c of this.nativeCues) this.native.removeCue(c);
    }
    this.restoreTracks();
    this.originalTrackModes.clear();
    this.host.remove();
  }
}
