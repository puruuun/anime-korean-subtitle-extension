import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildManifest } from '../scripts/manifest-config.mjs';
const base = JSON.parse(readFileSync('manifest.json', 'utf8'));
describe('install-time permission profiles', () => {
  it('grants personal builds all hosts at install without optional runtime host requests', () => {
    const m = buildManifest(base, 'personal');
    expect(m.host_permissions).toEqual(['<all_urls>']);
    expect(m.optional_host_permissions).toBeUndefined();
    expect(m.permissions).not.toContain('activeTab');
  });
  it('limits public builds and loads both worlds automatically in verified player frames', () => {
    const m = buildManifest(base, 'public');
    expect(m.host_permissions).not.toContain('<all_urls>');
    expect(m.host_permissions).toContain('https://api.github.com/*');
    for (const host of ['https://flixcloud.cc/*', 'https://strm.cx/*']) {
      expect(m.host_permissions).toContain(host);
      for (const script of m.content_scripts) {
        expect(script.matches).toContain(host);
        expect(script.all_frames).toBe(true);
        expect(script.match_origin_as_fallback).toBe(true);
      }
    }
    expect(m.optional_host_permissions).toEqual(['https://*/*', 'http://*/*']);
  });
});
