export function buildManifest(base, target = 'personal', browser = 'chrome') {
  if (!['personal', 'public'].includes(target))
    throw Error('Unknown extension build target: ' + target);
  if (!['chrome', 'firefox', 'safari'].includes(browser))
    throw Error('Unknown extension browser target: ' + browser);

  const manifest = structuredClone(base);
  if (target === 'personal') {
    manifest.host_permissions = ['<all_urls>'];
    delete manifest.optional_host_permissions;
  }

  if (browser === 'chrome') {
    manifest.version_name = base.version + (target === 'personal' ? ' 개인용' : ' 공개용');
    return manifest;
  }

  delete manifest.minimum_chrome_version;
  delete manifest.version_name;

  if (browser === 'firefox') {
    if (manifest.background?.service_worker) {
      manifest.background = {
        scripts: [manifest.background.service_worker],
        type: 'module',
      };
    }
    manifest.browser_specific_settings = {
      gecko: {
        id: 'web-video-subtitle@puruuun.github.io',
        strict_min_version: '128.0',
        data_collection_permissions: { required: ['none'] },
      },
      gecko_android: {
        strict_min_version: '128.0',
      },
    };
  } else if (browser === 'safari') {
    if (Array.isArray(manifest.content_scripts)) {
      manifest.content_scripts = manifest.content_scripts.map((entry) => {
        const next = { ...entry };
        delete next.match_origin_as_fallback;
        return next;
      });
    }
  }

  return manifest;
}
