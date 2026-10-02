export function buildManifest(base, target = 'personal') {
  if (!['personal', 'public'].includes(target))
    throw Error('Unknown extension build target: ' + target);
  const manifest = structuredClone(base);
  manifest.version_name = base.version + (target === 'personal' ? ' 개인용' : ' 공개용');
  if (target === 'personal') {
    manifest.host_permissions = ['<all_urls>'];
    delete manifest.optional_host_permissions;
  }
  return manifest;
}
