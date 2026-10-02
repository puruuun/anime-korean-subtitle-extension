import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestHost } from '../src/ui/api';
afterEach(() => vi.unstubAllGlobals());
describe('permissions only in explicit initial setup', () => {
  it('never requests an already granted host', async () => {
    const request = vi.fn();
    vi.stubGlobal('chrome', { permissions: { contains: async () => true, request } });
    await requestHost('http://127.0.0.1:1234/v1');
    expect(request).not.toHaveBeenCalled();
  });
  it.each([['<all_urls>'], ['https://*.blogspot.com/*']])(
    'reports a removed required grant without a request loop: %s',
    async (patterns) => {
      const request = vi.fn();
      vi.stubGlobal('chrome', {
        runtime: { getManifest: () => ({ host_permissions: [patterns] }) },
        permissions: { contains: async () => false, request },
      });
      await expect(requestHost('https://author.blogspot.com')).rejects.toThrow('Chrome');
      expect(request).not.toHaveBeenCalled();
    },
  );
  it('requests an unknown public-build domain once during setup and reuses the persisted grant', async () => {
    let granted = false;
    const request = vi.fn(async () => {
      granted = true;
      return true;
    });
    vi.stubGlobal('chrome', {
      runtime: { getManifest: () => ({ host_permissions: ['https://reanime.to/*'] }) },
      permissions: { contains: async () => granted, request },
    });
    await requestHost('https://new-author.example/post');
    await requestHost('https://new-author.example/other');
    expect(request).toHaveBeenCalledOnce();
  });
});
