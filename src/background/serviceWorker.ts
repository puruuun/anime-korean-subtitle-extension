import { checkUpdates, updateConnection, saveUpdateToken } from './updates';
import {
  startJob,
  cancelJob,
  trustedUI,
  currentStatus,
  contextChanged,
  syncFrame,
  updateOffset,
  reportPlayback,
  ensureAutomaticJob,
  episodeReady,
  episodeNavigating,
  preferencesChanged,
} from './messageRouter';
import { getSettings, saveSettings, validateSettings, type Settings } from '../storage/settings';
import { setOffset } from '../storage/offsets';
import { database } from '../storage/database';
import {
  frameInventory,
  injectFrames,
  recordFrame,
  collectSubtitles,
  supportedTab,
} from './frameManager';
import { createTranslationProvider } from '../translation/createTranslationProvider';
import { errorText } from '../utils/errors';
const storageReady = Promise.all([
  chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
  chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
]);
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  void (async () => {
    await storageReady;
    if (
      sender.tab?.id !== undefined &&
      sender.frameId !== undefined &&
      [
        'FRAME_READY',
        'CONTEXT_CHANGED',
        'EPISODE_READY',
        'EPISODE_NAVIGATING',
        'HEARTBEAT',
        'PLAYBACK_STATE',
      ].includes(m.type)
    ) {
      const tabId = sender.tab.id;
      if (!(await supportedTab(tabId))) throw Error('지원 사이트가 아닙니다.');
      if (m.type === 'FRAME_READY') {
        const changed = await recordFrame(
          sender,
          m.hasVideo === true,
          Number(m.area) || 0,
          Number(m.playerRevision) || 0,
        );
        if (changed) await syncFrame(tabId, sender.frameId);
        void ensureAutomaticJob(tabId);
        return { ok: true };
      }
      if (m.type === 'CONTEXT_CHANGED' && sender.frameId === 0) {
        await contextChanged(tabId);
        return { ok: true };
      }
      if (m.type === 'EPISODE_NAVIGATING' && sender.frameId === 0) {
        await episodeNavigating(tabId);
        return { ok: true };
      }
      if (m.type === 'EPISODE_READY' && sender.frameId === 0) {
        await episodeReady(tabId, m.context);
        return { ok: true };
      }
      if (m.type === 'PLAYBACK_STATE') {
        await reportPlayback(tabId, sender, m);
        return { ok: true };
      }
      if (m.type === 'HEARTBEAT') return { ok: true };
    }
    if (!trustedUI(sender)) throw Error('허용되지 않은 요청입니다.');
    switch (m.type) {
      case 'RUN':
        return {
          ok: true,
          status: await startJob(m.tabId, m.mode, m.context, m.selectedId, m.refresh === true),
        };
      case 'CANCEL':
        await cancelJob(m.tabId);
        return { ok: true };
      case 'GET_STATUS':
        return { ok: true, status: await currentStatus(m.tabId) };
      case 'GET_PREFERENCES':
        return { ok: true, mode: (await getSettings()).mode };
      case 'SET_MODE': {
        const settings = await getSettings();
        settings.mode = m.mode;
        validateSettings(settings);
        await saveSettings(settings);
        await preferencesChanged();
        return { ok: true };
      }
      case 'UPDATE_CONNECTION':
        return { ok: true, ...(await updateConnection()) };
      case 'CHECK_UPDATES':
        return { ok: true, status: await checkUpdates(m.force === true) };
      case 'SAVE_UPDATE_TOKEN':
        return { ok: true, ...(await saveUpdateToken(m.token)) };
      case 'GET_SETTINGS':
        return { ok: true, settings: await getSettings() };
      case 'SAVE_SETTINGS': {
        const previous = await getSettings();
        await saveSettings(m.settings);
        const next = await getSettings();
        if (previous.mode !== next.mode || previous.autoApply !== next.autoApply)
          await preferencesChanged();
        return { ok: true };
      }
      case 'ACCESS_STATUS': {
        const manifest = chrome.runtime.getManifest();
        const profile = manifest.host_permissions?.includes('<all_urls>') ? 'personal' : 'public';
        const tab = await chrome.tabs.get(m.tabId);
        const origins = [
          tab.url,
          ...(await frameInventory(m.tabId).catch(() => []))
            .filter(
              (f) =>
                f.frameId !== 0 &&
                (f.hasVideo || /https:\/\/(?:strm\.cx|flixcloud\.cc)\//.test(f.url)),
            )
            .map((f) => f.url),
        ].flatMap((url) => {
          try {
            const u = new URL(url ?? '');
            return /^https?:$/.test(u.protocol) ? [u.origin + '/*'] : [];
          } catch {
            return [];
          }
        });
        const missing = [];
        for (const origin of new Set([...(manifest.host_permissions ?? []), ...origins]))
          if (!(await chrome.permissions.contains({ origins: [origin] }))) missing.push(origin);
        return { ok: true, profile, missing };
      }
      case 'TEST_CONNECTION':
        validateSettings(m.settings as Settings);
        return {
          ok: true,
          models: await createTranslationProvider(m.settings.translation).testConnection(),
        };
      case 'FRAME_INVENTORY':
        return { ok: true, frames: await frameInventory(m.tabId) };
      case 'SOURCE_ORIGINS': {
        const sources = await collectSubtitles(m.tabId);
        return {
          ok: true,
          origins: [
            ...new Set(
              sources
                .filter((s) => s.url)
                .map((s) => {
                  try {
                    return new URL(s.url!).origin.replace(/:\d+$/, '') + '/*';
                  } catch {
                    return '';
                  }
                })
                .filter(Boolean),
            ),
          ],
        };
      }
      case 'INJECT_FRAMES':
        await injectFrames(m.tabId);
        return { ok: true };
      case 'OFFSET': {
        if (!(await supportedTab(m.tabId))) throw Error('지원 사이트가 아닙니다.');
        const status = await currentStatus(m.tabId);
        if (!status) throw Error('먼저 자막을 적용하세요.');
        const offset = await setOffset(status.context, Number(m.offset));
        await updateOffset(m.tabId, offset);
        return { ok: true, offset };
      }
      case 'CLEAR_CACHE':
        await database.clear();
        return { ok: true };
      default:
        throw Error('알 수 없는 요청입니다.');
    }
  })().then(reply, (e) => reply({ ok: false, error: errorText(e) }));
  return true;
});
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install')
    void getSettings()
      .then(saveSettings)
      .then(() => chrome.tabs.create({ url: chrome.runtime.getURL('settings.html') }));
});

// A full document navigation must cancel the outgoing episode before the new page settles.
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId === 0)
    void supportedTab(details.tabId)
      .then((supported) => {
        if (supported) return episodeNavigating(details.tabId);
      })
      .catch(() => {});
});
