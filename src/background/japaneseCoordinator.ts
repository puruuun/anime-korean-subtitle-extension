import type { JapaneseStatus } from '../subtitle/SecondaryJapanese';
import { secondaryJapanese } from '../subtitle/SecondaryJapanese';
import { createProviders } from '../providers/createProviders';
import { collectSubtitles, sendVideoMessage } from './frameManager';
import type { CoreStatus } from '../subtitle/SubtitleCore';
import type { Job } from './routerTypes';

export interface JapaneseCoordinatorDeps {
  active: (tabId: number, j: Job) => boolean;
  publish: (tabId: number, j: Job, s: CoreStatus) => Promise<void>;
  persistRender: (tabId: number, j: Job) => Promise<void>;
}

async function sendJapanese(tabId: number, j: Job, deps: JapaneseCoordinatorDeps) {
  await deps.persistRender(tabId, j);
  if (deps.active(tabId, j))
    await sendVideoMessage(tabId, {
      type: 'JAPANESE_CUES',
      epoch: j.status.epoch,
      cues: j.japaneseCues ?? [],
    });
}

export async function japaneseStatus(
  tabId: number,
  j: Job,
  status: JapaneseStatus,
  deps: JapaneseCoordinatorDeps,
) {
  if (!deps.active(tabId, j) || (status.state !== 'off' && !j.settings.display.showJapanese)) return;
  j.status.japanese = status;
  await deps.publish(tabId, j, { stage: j.status.stage, message: j.status.message });
}

export function ensureJapanese(tabId: number, j: Job, deps: JapaneseCoordinatorDeps) {
  if (!deps.active(tabId, j) || !j.settings.display.showJapanese) return;
  if (j.japaneseCues?.length) {
    if (j.status.japanese?.state === 'ready') return;
    void (async () => {
      await sendJapanese(tabId, j, deps);
      await japaneseStatus(
        tabId,
        j,
        {
          state: 'ready',
          source: j.japaneseSource,
          message: '일본어 원문 함께 표시 중',
        },
        deps,
      );
    })();
    return;
  }
  if (j.japaneseController) return;
  const controller = new AbortController();
  j.japaneseController = controller;
  const abort = () => controller.abort();
  j.controller.signal.addEventListener('abort', abort, { once: true });
  void (async () => {
    try {
      await japaneseStatus(
        tabId,
        j,
        {
          state: 'searching',
          message: '한국어 자막은 유지하며 일본어 원문을 찾는 중…',
        },
        deps,
      );
      const skipExternal =
        j.status.mode === 'auto' &&
        j.sourceLanguage === 'en' &&
        j.settings.autoSources.japaneseTranslation;
      const result = await secondaryJapanese(
        j.status.context,
        createProviders(j.settings, controller.signal),
        controller.signal,
        () => collectSubtitles(tabId),
        skipExternal,
      );
      if (!deps.active(tabId, j) || controller.signal.aborted || j.japaneseController !== controller)
        return;
      if (result) {
        j.japaneseCues = result.cues;
        j.japaneseSource = result.source;
        await sendJapanese(tabId, j, deps);
        await japaneseStatus(
          tabId,
          j,
          {
            state: 'ready',
            source: result.source,
            message: '일본어 원문 함께 표시 중',
          },
          deps,
        );
      } else {
        await japaneseStatus(
          tabId,
          j,
          {
            state: 'unavailable',
            message: '이 회차의 일본어 원문 자막을 찾지 못했습니다. 한국어 자막은 계속 표시합니다.',
          },
          deps,
        );
      }
    } catch {
      if (deps.active(tabId, j) && !controller.signal.aborted)
        await japaneseStatus(
          tabId,
          j,
          {
            state: 'error',
            message: '일본어 추가 자막을 가져오지 못했습니다. 한국어 자막은 계속 표시합니다.',
          },
          deps,
        );
    } finally {
      j.controller.signal.removeEventListener('abort', abort);
      if (j.japaneseController === controller) j.japaneseController = undefined;
    }
  })();
}
