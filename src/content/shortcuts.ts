export type ShortcutMessage =
  | { type: 'SHORTCUT_OFFSET'; delta?: number; reset?: boolean }
  | { type: 'SHORTCUT_JAPANESE' };

function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false;
  const el = target as HTMLElement;
  if (el.isContentEditable) return true;
  const tag = el.tagName?.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export function resolveShortcut(event: KeyboardEvent): ShortcutMessage | undefined {
  if (
    event.defaultPrevented ||
    event.repeat ||
    !event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    isEditableTarget(event.target)
  )
    return undefined;
  if (event.code === 'BracketLeft' || event.key === '[')
    return { type: 'SHORTCUT_OFFSET', delta: -0.5 };
  if (event.code === 'BracketRight' || event.key === ']')
    return { type: 'SHORTCUT_OFFSET', delta: 0.5 };
  if (event.code === 'Backslash' || event.key === '\\')
    return { type: 'SHORTCUT_OFFSET', reset: true };
  if (event.code === 'KeyJ' || event.key?.toLowerCase() === 'j')
    return { type: 'SHORTCUT_JAPANESE' };
  return undefined;
}
