export function findVideo(root: Document | ShadowRoot = document): HTMLVideoElement | null {
  const videos = [...root.querySelectorAll<HTMLVideoElement>('video')];
  for (const e of root.querySelectorAll('*'))
    if (e.shadowRoot) {
      const v = findVideo(e.shadowRoot);
      if (v) videos.push(v);
    }
  return (
    videos.sort((a, b) => {
      const ar = a.getBoundingClientRect(),
        br = b.getBoundingClientRect();
      return br.width * br.height - ar.width * ar.height;
    })[0] ?? null
  );
}
