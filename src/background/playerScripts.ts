import type { FrameInfo } from './frameManager';
export async function registerPlayerScripts(frames: FrameInfo[]) {
  const candidates = [
    ...new Set(
      frames
        .filter((f) => f.frameId !== 0)
        .flatMap((f) => {
          try {
            const u = new URL(f.url);
            return ['http:', 'https:'].includes(u.protocol)
              ? [u.origin.replace(/:\d+$/, '') + '/*']
              : [];
          } catch {
            return [];
          }
        }),
    ),
  ];
  const allowed = await Promise.all(
    candidates.map(async (origin) =>
      (await chrome.permissions.contains({ origins: [origin] })) ? origin : undefined,
    ),
  );
  const existing = await chrome.scripting.getRegisteredContentScripts({
    ids: ['animesub-player-main', 'animesub-player-isolated'],
  });
  const matches = [
    ...new Set([
      ...existing.flatMap((s) => s.matches ?? []),
      ...allowed.filter((v): v is string => !!v),
    ]),
  ].slice(0, 100);
  if (!matches.length) return;
  for (const [id, world, js] of [
    ['animesub-player-main', 'MAIN', 'pageBridge.js'],
    ['animesub-player-isolated', 'ISOLATED', 'contentScript.js'],
  ] as const) {
    const script = {
      id,
      matches,
      world,
      js: [js],
      allFrames: true,
      runAt: 'document_start' as const,
      persistAcrossSessions: true,
    };
    if (existing.some((s) => s.id === id)) await chrome.scripting.updateContentScripts([script]);
    else await chrome.scripting.registerContentScripts([script]);
  }
}
