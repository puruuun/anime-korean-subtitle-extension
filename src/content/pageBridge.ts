// Runs in MAIN world. Only public subtitle/metadata fields cross the boundary.
export {};
declare global {
  interface Window {
    __animeSubBridgeV1?: boolean;
  }
}
if (!window.__animeSubBridgeV1) {
  window.__animeSubBridgeV1 = true;
  const emit = (kind: string, data: unknown) =>
    window.postMessage({ channel: 'ANIMESUB_PUBLIC_V1', kind, data }, '*');
  for (const name of ['pushState', 'replaceState'] as const) {
    const original = history[name];
    history[name] = function (...args: Parameters<History[typeof name]>) {
      const result = original.apply(this, args);
      window.dispatchEvent(new Event('animesub:navigation'));
      return result;
    };
  }
  const url = (v: unknown, base: string) => {
    if (typeof v !== 'string' || v.length > 8192) return undefined;
    try {
      const u = new URL(v, base);
      return u.protocol === 'https:' ? u.href : undefined;
    } catch {
      return undefined;
    }
  };
  const metadataResponse = (base: string) => {
    try {
      const u = new URL(base);
      return (
        /^\/v1\/anime\/[^/]+$/.test(u.pathname) || /^\/api\/v1\/watch\/[^/]+$/.test(u.pathname)
      );
    } catch {
      return false;
    }
  };
  const inspect = (value: unknown, base: string, depth = 0, parent = '') => {
    if (depth > 7 || !value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.slice(0, 150).forEach((v) => inspect(v, base, depth + 1, parent));
      return;
    }
    const v = value as Record<string, unknown>;
    if (
      metadataResponse(base) &&
      v.title &&
      (v.external_ids || v.anime_id || v.anilist_id || parent === 'anime')
    ) {
      const t = v.title;
      const title =
        typeof t === 'string'
          ? t.slice(0, 500)
          : t && typeof t === 'object'
            ? Object.fromEntries(
                ['english', 'romaji', 'native']
                  .map((k) => [k, (t as Record<string, unknown>)[k]])
                  .filter(([, a]) => typeof a === 'string'),
              )
            : undefined;
      const ids = v.external_ids;
      const external_ids =
        ids && typeof ids === 'object'
          ? Object.fromEntries(
              ['anilist', 'mal', 'tmdb', 'imdb']
                .map((k) => [k, (ids as Record<string, unknown>)[k]])
                .filter(
                  ([, a]) =>
                    typeof a === 'string' ||
                    typeof a === 'number' ||
                    (Array.isArray(a) &&
                      a.every((x) => typeof x === 'string' || typeof x === 'number')),
                ),
            )
          : undefined;
      const metadata = {
        title,
        external_ids,
        ...Object.fromEntries(
          ['anilist_id', 'mal_id', 'imdb_id', 'themoviedb_id', 'season_year']
            .map((k) => [k, v[k]])
            .filter(([, a]) => typeof a === 'string' || typeof a === 'number'),
        ),
      };
      emit('metadata', metadata);
    }
    if (/subtitle|track/i.test(parent) || v.kind === 'captions' || v.kind === 'subtitles') {
      const src = url(v.file ?? v.src ?? v.url, base);
      const language = v.language ?? v.lang ?? v.srclang ?? v.label;
      const label = v.label ?? v.name;
      if (src && typeof language === 'string')
        emit('source', {
          url: src,
          language: language.slice(0, 80),
          label: typeof label === 'string' ? label.slice(0, 100) : undefined,
          kind: /\.m3u8(?:[?#]|$)/i.test(src) ? 'hls' : 'file',
          format: typeof v.format === 'string' ? v.format : undefined,
        });
    }
    for (const [key, item] of Object.entries(v))
      if (
        [
          'data',
          'anime',
          'media',
          'playback',
          'source',
          'sources',
          'subtitles',
          'tracks',
          'captions',
          'result',
          'episodeSources',
        ].includes(key)
      )
        inspect(item, base, depth + 1, key);
  };
  const hls = (text: string, base: string) => {
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith('#EXT-X-MEDIA:') || !line.includes('TYPE=SUBTITLES')) continue;
      const fields: Record<string, string> = {};
      for (const m of line.matchAll(/([A-Z-]+)=("[^"]*"|[^,]+)/g))
        fields[m[1]] = m[2].replace(/^"|"$/g, '');
      const src = url(fields.URI, base);
      if (src)
        emit('source', {
          url: src,
          language: fields.LANGUAGE ?? fields.NAME ?? '',
          label: fields.NAME,
          kind: 'hls',
        });
    }
  };
  const relevant = (u: string, type: string) =>
    /\/v1\/(?:anime|watch)\//.test(u) ||
    (/json/i.test(type) && /player|source|playback|subtitle|caption|track/i.test(u)) ||
    /\.m3u8(?:[?#]|$)/i.test(u);
  const observe = async (response: Response) => {
    if (
      !relevant(response.url, response.headers.get('content-type') ?? '') ||
      Number(response.headers.get('content-length')) > 1024 * 1024
    )
      return;
    try {
      const clone = response.clone();
      const reader = clone.body?.getReader();
      if (!reader) return;
      let size = 0;
      const chunks: Uint8Array[] = [];
      for (;;) {
        const r = await reader.read();
        if (r.done) break;
        size += r.value.length;
        if (size > 1024 * 1024) {
          await reader.cancel();
          return;
        }
        chunks.push(r.value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const c of chunks) {
        bytes.set(c, offset);
        offset += c.length;
      }
      const text = new TextDecoder().decode(bytes);
      if (text.startsWith('#EXTM3U')) hls(text, response.url);
      else inspect(JSON.parse(text), response.url);
    } catch {}
  };
  const originalFetch = window.fetch;
  window.fetch = function (...args: Parameters<typeof fetch>) {
    const observedPage = location.href;
    const promise = originalFetch.apply(this, args);
    void promise.then(
      (r) => {
        if (location.href === observedPage) void observe(r);
      },
      () => {},
    );
    return promise;
  };
  const originalOpen = XMLHttpRequest.prototype.open,
    originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (
    method: string,
    u: string | URL,
    async: boolean = true,
    username?: string | null,
    password?: string | null,
  ) {
    return originalOpen.call(this, method, u, async, username, password);
  };
  XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
    this.addEventListener(
      'load',
      () => {
        try {
          const type = this.getResponseHeader('content-type') ?? '';
          if (!relevant(this.responseURL, type)) return;
          if (this.responseType === 'json') inspect(this.response, this.responseURL);
          else if (!this.responseType || this.responseType === 'text') {
            if (this.responseText.length > 1024 * 1024) return;
            if (this.responseText.startsWith('#EXTM3U')) hls(this.responseText, this.responseURL);
            else inspect(JSON.parse(this.responseText), this.responseURL);
          }
        } catch {}
      },
      { once: true },
    );
    return originalSend.call(this, body);
  };
}
