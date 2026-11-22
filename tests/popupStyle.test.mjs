import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/ui/style.css', 'utf8');

describe('popup CSS desktop & mobile sizing invariants', () => {
  it('keeps fixed intrinsic pixel dimensions on base .popup so desktop Chrome popups do not collapse', () => {
    const basePopupMatch = css.match(/(?:^|\n)\.popup\s*\{([^}]*)\}/);
    expect(basePopupMatch).not.toBeNull();
    const block = basePopupMatch[1].replace(/\/\*[\s\S]*?\*\//g, '');
    expect(block).toMatch(/\bwidth\s*:\s*420px\s*;/);
    expect(block).toMatch(/\bmin-width\s*:\s*420px\s*;/);
    expect(block).toMatch(/\bheight\s*:\s*600px\s*;/);
    expect(block).not.toMatch(/100vw|100vh|100dvh/);
  });

  it('scopes fluid mobile popup sizing to coarse-pointer touch devices only', () => {
    const touchMediaMatch = css.match(
      /@media\s*\(hover:\s*none\)\s*and\s*\(pointer:\s*coarse\)\s*\{([\s\S]*?)\n\}/,
    );
    expect(touchMediaMatch).not.toBeNull();
    expect(touchMediaMatch[1]).toContain('.popup');
    expect(touchMediaMatch[1]).toMatch(/width\s*:\s*100%/);
    expect(touchMediaMatch[1]).toMatch(/min-width\s*:\s*0/);
  });

  it('does not apply @media (max-width: 480px) main padding onto .popup', () => {
    const narrowMediaMatch = css.match(/@media\s*\(max-width:\s*480px\)\s*\{([\s\S]*?)\n\}/);
    expect(narrowMediaMatch).not.toBeNull();
    expect(narrowMediaMatch[1]).toContain('main:not(.popup)');
  });
});
