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
    for (const host of ['https://*.miruro.tv/*', 'https://*.miruro.online/*']) {
      expect(m.host_permissions).toContain(host);
      for (const script of m.content_scripts) {
        expect(script.matches).toContain(host);
      }
    }
    expect(m.optional_host_permissions).toEqual(['https://*/*', 'http://*/*']);
  });
  it('builds firefox manifests with gecko settings and background scripts', () => {
    const personal = buildManifest(base, 'personal', 'firefox');
    expect(personal.host_permissions).toEqual(['<all_urls>']);
    expect(personal.optional_host_permissions).toBeUndefined();
    expect(personal.minimum_chrome_version).toBeUndefined();
    expect(personal.version_name).toBeUndefined();
    expect(personal.background).toEqual({ scripts: ['serviceWorker.js'], type: 'module' });
    expect(personal.browser_specific_settings).toEqual({
      gecko: {
        id: 'web-video-subtitle@puruuun.github.io',
        strict_min_version: '128.0',
        data_collection_permissions: { required: ['none'] },
      },
      gecko_android: { strict_min_version: '128.0' },
    });

    const pub = buildManifest(base, 'public', 'firefox');
    expect(pub.host_permissions).not.toContain('<all_urls>');
    expect(pub.optional_host_permissions).toEqual(['https://*/*', 'http://*/*']);
    expect(pub.background).toEqual({ scripts: ['serviceWorker.js'], type: 'module' });
  });
  it('builds safari manifests without chrome-only fields or match_origin_as_fallback', () => {
    const personal = buildManifest(base, 'personal', 'safari');
    expect(personal.host_permissions).toEqual(['<all_urls>']);
    expect(personal.optional_host_permissions).toBeUndefined();
    expect(personal.minimum_chrome_version).toBeUndefined();
    expect(personal.version_name).toBeUndefined();
    expect(personal.background).toEqual({ service_worker: 'serviceWorker.js', type: 'module' });
    for (const script of personal.content_scripts) {
      expect(script.match_origin_as_fallback).toBeUndefined();
    }

    const pub = buildManifest(base, 'public', 'safari');
    expect(pub.host_permissions).not.toContain('<all_urls>');
    expect(pub.optional_host_permissions).toEqual(['https://*/*', 'http://*/*']);
    for (const script of pub.content_scripts) {
      expect(script.match_origin_as_fallback).toBeUndefined();
    }
  });
  it('throws on unknown target or browser', () => {
    expect(() => buildManifest(base, 'unknown', 'chrome')).toThrow(
      'Unknown extension build target: unknown',
    );
    expect(() => buildManifest(base, 'personal', 'edge')).toThrow(
      'Unknown extension browser target: edge',
    );
  });
});
