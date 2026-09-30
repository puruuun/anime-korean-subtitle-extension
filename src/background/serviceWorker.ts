import {
  startJob,
  cancelJob,
  trustedUI,
  currentStatus,
  contextChanged,
  syncFrame,
  updateOffset,
  reportPlayback,
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
import { OpenAICompatibleProvider } from '../translation/openaiCompatible/OpenAICompatibleProvider';
import { OpenSubtitlesProvider } from '../providers/opensubtitles/OpenSubtitlesProvider';
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
      ['FRAME_READY', 'CONTEXT_CHANGED', 'HEARTBEAT', 'PLAYBACK_STATE'].includes(m.type)
    ) {
      const tabId = sender.tab.id;
      if (!(await supportedTab(tabId))) throw Error('지원 사이트가 아닙니다.');
      if (m.type === 'FRAME_READY') {
        const changed = await recordFrame(sender, m.hasVideo === true, Number(m.area) || 0);
        if (changed) await syncFrame(tabId, sender.frameId);
        return { ok: true };
      }
      if (m.type === 'CONTEXT_CHANGED' && sender.frameId === 0) {
        await contextChanged(tabId);
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
        return { ok: true, status: await startJob(m.tabId, m.mode, m.context, m.selectedId) };
      case 'CANCEL':
        await cancelJob(m.tabId);
        return { ok: true };
      case 'GET_STATUS':
        return { ok: true, status: await currentStatus(m.tabId) };
      case 'GET_SETTINGS':
        return { ok: true, settings: await getSettings() };
      case 'SAVE_SETTINGS':
        await saveSettings(m.settings);
        return { ok: true };
      case 'TEST_CONNECTION':
        validateSettings(m.settings as Settings);
        return {
          ok: true,
          models: await new OpenAICompatibleProvider(m.settings.translation).testConnection(),
        };
      case 'LOGIN_OPENSUBTITLES': {
        const s = await getSettings();
        const result = await new OpenSubtitlesProvider(m.config).login();
        s.providers.opensubtitles = { ...s.providers.opensubtitles, ...m.config, ...result };
        await saveSettings(s);
        return { ok: true };
      }
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
