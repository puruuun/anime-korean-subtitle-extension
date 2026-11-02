// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { resolveShortcut } from '../src/content/shortcuts';

function makeKeyEvent(
  init: {
    code?: string;
    key?: string;
    altKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
    repeat?: boolean;
    defaultPrevented?: boolean;
    target?: EventTarget | null;
  } = {},
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    code: init.code,
    key: init.key,
    altKey: init.altKey ?? true,
    ctrlKey: init.ctrlKey ?? false,
    metaKey: init.metaKey ?? false,
    shiftKey: init.shiftKey ?? false,
    repeat: init.repeat ?? false,
    bubbles: true,
    cancelable: true,
  });

  if (init.defaultPrevented) {
    event.preventDefault();
  }

  if (init.target !== undefined) {
    Object.defineProperty(event, 'target', { value: init.target, configurable: true });
  }

  return event;
}

describe('resolveShortcut', () => {
  describe('valid shortcuts', () => {
    it('resolves Alt + [ to SHORTCUT_OFFSET delta -0.5', () => {
      const byCode = makeKeyEvent({ code: 'BracketLeft', key: '[' });
      expect(resolveShortcut(byCode)).toEqual({ type: 'SHORTCUT_OFFSET', delta: -0.5 });

      const byKeyOnly = makeKeyEvent({ key: '[' });
      expect(resolveShortcut(byKeyOnly)).toEqual({ type: 'SHORTCUT_OFFSET', delta: -0.5 });
    });

    it('resolves Alt + ] to SHORTCUT_OFFSET delta 0.5', () => {
      const byCode = makeKeyEvent({ code: 'BracketRight', key: ']' });
      expect(resolveShortcut(byCode)).toEqual({ type: 'SHORTCUT_OFFSET', delta: 0.5 });

      const byKeyOnly = makeKeyEvent({ key: ']' });
      expect(resolveShortcut(byKeyOnly)).toEqual({ type: 'SHORTCUT_OFFSET', delta: 0.5 });
    });

    it('resolves Alt + \\ to SHORTCUT_OFFSET reset true', () => {
      const byCode = makeKeyEvent({ code: 'Backslash', key: '\\' });
      expect(resolveShortcut(byCode)).toEqual({ type: 'SHORTCUT_OFFSET', reset: true });

      const byKeyOnly = makeKeyEvent({ key: '\\' });
      expect(resolveShortcut(byKeyOnly)).toEqual({ type: 'SHORTCUT_OFFSET', reset: true });
    });

    it('resolves Alt + J to SHORTCUT_JAPANESE', () => {
      const byCode = makeKeyEvent({ code: 'KeyJ', key: 'j' });
      expect(resolveShortcut(byCode)).toEqual({ type: 'SHORTCUT_JAPANESE' });

      const byKeyUppercase = makeKeyEvent({ key: 'J' });
      expect(resolveShortcut(byKeyUppercase)).toEqual({ type: 'SHORTCUT_JAPANESE' });
    });
  });

  describe('editable targets', () => {
    it('returns undefined when target is input', () => {
      const input = document.createElement('input');
      const event = makeKeyEvent({ code: 'BracketLeft', key: '[', target: input });
      expect(resolveShortcut(event)).toBeUndefined();
    });

    it('returns undefined when target is textarea', () => {
      const textarea = document.createElement('textarea');
      const event = makeKeyEvent({ code: 'BracketRight', key: ']', target: textarea });
      expect(resolveShortcut(event)).toBeUndefined();
    });

    it('returns undefined when target is select', () => {
      const select = document.createElement('select');
      const event = makeKeyEvent({ code: 'Backslash', key: '\\', target: select });
      expect(resolveShortcut(event)).toBeUndefined();
    });

    it('returns undefined when target is contentEditable', () => {
      const div = document.createElement('div');
      Object.defineProperty(div, 'isContentEditable', { value: true, configurable: true });
      const event = makeKeyEvent({ code: 'KeyJ', key: 'j', target: div });
      expect(resolveShortcut(event)).toBeUndefined();
    });

    it('allows shortcut when target is a non-editable element', () => {
      const div = document.createElement('div');
      const event = makeKeyEvent({ code: 'BracketLeft', key: '[', target: div });
      expect(resolveShortcut(event)).toEqual({ type: 'SHORTCUT_OFFSET', delta: -0.5 });
    });
  });

  describe('modifier keys and edge conditions', () => {
    it('returns undefined when altKey is false', () => {
      const event = makeKeyEvent({ code: 'BracketLeft', key: '[', altKey: false });
      expect(resolveShortcut(event)).toBeUndefined();
    });

    it('returns undefined when ctrlKey is true', () => {
      const event = makeKeyEvent({ code: 'BracketLeft', key: '[', ctrlKey: true });
      expect(resolveShortcut(event)).toBeUndefined();
    });

    it('returns undefined when metaKey is true', () => {
      const event = makeKeyEvent({ code: 'BracketLeft', key: '[', metaKey: true });
      expect(resolveShortcut(event)).toBeUndefined();
    });

    it('returns undefined when shiftKey is true', () => {
      const event = makeKeyEvent({ code: 'BracketLeft', key: '[', shiftKey: true });
      expect(resolveShortcut(event)).toBeUndefined();
    });

    it('returns undefined when repeat is true', () => {
      const event = makeKeyEvent({ code: 'BracketLeft', key: '[', repeat: true });
      expect(resolveShortcut(event)).toBeUndefined();
    });

    it('returns undefined when defaultPrevented is true', () => {
      const event = makeKeyEvent({ code: 'BracketLeft', key: '[', defaultPrevented: true });
      expect(resolveShortcut(event)).toBeUndefined();
    });

    it('returns undefined for unmapped keys with Alt', () => {
      const event = makeKeyEvent({ code: 'KeyA', key: 'a' });
      expect(resolveShortcut(event)).toBeUndefined();
    });
  });
});
