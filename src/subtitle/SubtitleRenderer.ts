import type { SubtitleCue } from './SubtitleCue';
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
export class SubtitleRenderer {
  private cues: SubtitleCue[] = [];
  private offset = 0;
  private host = document.createElement('div');
  private line = document.createElement('div');
  private raf = 0;
  private frame: number | undefined;
  private disposed = false;
  private display = defaultDisplay;
  private last = '';
  constructor(private video: HTMLVideoElement) {
    this.host.dataset.animesubOverlay = 'true';
    const shadow = this.host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent =
      ':host{pointer-events:none!important;z-index:2147483647!important;position:fixed!important;display:block!important}div{position:absolute;left:4%;right:4%;text-align:center;white-space:pre-line;font-family:Arial,"Noto Sans KR",sans-serif;color:white;line-height:1.35;overflow:hidden;}span{box-decoration-break:clone;-webkit-box-decoration-break:clone;padding:3px 9px;border-radius:5px}';
    shadow.append(style, this.line);
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
    this.cues = [...cues].sort((a, b) => a.startTime - b.startTime);
    this.render();
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
  private relocate = () => {
    const full = document.fullscreenElement;
    // A native text track is needed when the video itself is the fullscreen root.
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
    this.nativeCues = active.map(
      (c) => new VTTCue(0, Math.max(86400, this.video.duration || 0), c.text),
    );
    this.nativeCues.forEach((c) => this.native!.addCue(c));
    this.native.mode = 'showing';
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
    const text = active
      .map((c) => c.text)
      .join('\n')
      .split('\n')
      .slice(0, this.display.maxLines)
      .join('\n');
    const native = document.fullscreenElement === this.video;
    this.host.style.visibility = native || r.width === 0 ? 'hidden' : 'visible';
    if (!native && this.native) this.native.mode = 'disabled';
    const key = String(native) + text;
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
    document.removeEventListener('fullscreenchange', this.relocate);
    window.removeEventListener('resize', this.render);
    window.removeEventListener('scroll', this.render, true);
    if (this.native) {
      this.native.mode = 'disabled';
      for (const c of this.nativeCues) this.native.removeCue(c);
    }
    this.host.remove();
  }
}
