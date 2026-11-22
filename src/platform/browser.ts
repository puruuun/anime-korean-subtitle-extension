export type BrowserFamily = 'chrome' | 'firefox' | 'safari';

export type StorageAccessLevel = 'TRUSTED_CONTEXTS' | 'TRUSTED_AND_UNTRUSTED_CONTEXTS';

export interface StorageAreaWithAccessLevel {
  setAccessLevel?: (opts: { accessLevel: StorageAccessLevel }) => Promise<void>;
}

export function detectBrowserFamily(ua?: string, runtimeUrl?: string): BrowserFamily {
  const resolvedUrl = (
    runtimeUrl ??
    (typeof chrome !== 'undefined' && typeof chrome.runtime?.getURL === 'function'
      ? chrome.runtime.getURL('')
      : '')
  ).toLowerCase();

  if (resolvedUrl.startsWith('moz-extension://')) return 'firefox';
  if (resolvedUrl.startsWith('safari-web-extension://')) return 'safari';
  if (resolvedUrl.startsWith('chrome-extension://')) return 'chrome';

  const resolvedUa = ua ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '');
  if (/firefox/i.test(resolvedUa)) return 'firefox';
  if (/safari/i.test(resolvedUa) && !/chrome|chromium|edg/i.test(resolvedUa)) return 'safari';
  return 'chrome';
}

export async function safeSetAccessLevel(
  area: StorageAreaWithAccessLevel | undefined,
  accessLevel: StorageAccessLevel,
): Promise<void> {
  if (typeof area?.setAccessLevel === 'function') {
    await area.setAccessLevel({ accessLevel });
  }
}

function isUnsupportedDocumentIdError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /documentid/i.test(message);
}

export async function sendTabMessageSafe(
  tabId: number,
  message: unknown,
  options: { frameId: number; documentId?: string },
): Promise<any> {
  if (options.documentId === undefined) {
    return chrome.tabs.sendMessage(tabId, message, { frameId: options.frameId });
  }
  try {
    return await chrome.tabs.sendMessage(tabId, message, {
      frameId: options.frameId,
      documentId: options.documentId,
    });
  } catch (error) {
    // Firefox and Safari reject documentId as an unknown tabs.sendMessage option.
    if (isUnsupportedDocumentIdError(error)) {
      return chrome.tabs.sendMessage(tabId, message, { frameId: options.frameId });
    }
    throw error;
  }
}

export async function openExtensionManager(): Promise<void> {
  const family = detectBrowserFamily();
  if (family === 'firefox') {
    await chrome.tabs.create({ url: 'about:addons' });
    return;
  }
  if (family === 'safari') {
    if (typeof chrome.runtime?.openOptionsPage === 'function') {
      await chrome.runtime.openOptionsPage();
    }
    return;
  }
  await chrome.tabs.create({ url: 'chrome://extensions/?id=' + chrome.runtime.id });
}
