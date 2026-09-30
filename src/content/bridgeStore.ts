import type { PublicMetadata, SubtitleSource } from '../sites/types';
export const bridgeStore: { metadata: PublicMetadata[]; sources: SubtitleSource[] } = {
  metadata: [],
  sources: [],
};
export function installBridgeListener() {
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data?.channel !== 'ANIMESUB_PUBLIC_V1') return;
    const data = event.data.data;
    if (!data || typeof data !== 'object') return;
    if (event.data.kind === 'metadata') {
      const s = JSON.stringify(data);
      if (s.length > 10000) return;
      bridgeStore.metadata.push(data as PublicMetadata);
      bridgeStore.metadata.splice(0, Math.max(0, bridgeStore.metadata.length - 8));
    } else if (
      event.data.kind === 'source' &&
      typeof data.url === 'string' &&
      data.url.length < 8192 &&
      typeof data.language === 'string' &&
      data.language.length < 100 &&
      ['file', 'hls'].includes(data.kind)
    ) {
      try {
        const u = new URL(data.url);
        if (u.protocol !== 'https:') return;
        if (!bridgeStore.sources.some((s) => s.url === u.href))
          bridgeStore.sources.push({
            url: u.href,
            language: data.language,
            label: typeof data.label === 'string' ? data.label.slice(0, 100) : undefined,
            kind: data.kind,
          });
        bridgeStore.sources.splice(0, Math.max(0, bridgeStore.sources.length - 100));
      } catch {}
    }
  });
}
export function clearBridge() {
  bridgeStore.metadata = [];
  bridgeStore.sources = [];
}
