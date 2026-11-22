import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const REQUIRED_FILES = [
  'manifest.json',
  'serviceWorker.js',
  'contentScript.js',
  'pageBridge.js',
  'popup.html',
  'popup.js',
  'settings.html',
  'settings.js',
];

function getArg(prefix) {
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : undefined;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function assertFilesExist(dir) {
  for (const file of REQUIRED_FILES) {
    await access(join(dir, file));
  }
}

async function verifyProfile(dir, expectedVersion, profile, browser) {
  await assertFilesExist(dir);
  const manifest = await readJson(join(dir, 'manifest.json'));
  if (manifest.version !== expectedVersion) {
    throw new Error(
      `[${profile}] manifest version (${manifest.version}) does not match ${expectedVersion}`,
    );
  }
  if (profile === 'personal') {
    if (
      !Array.isArray(manifest.host_permissions) ||
      manifest.host_permissions.length !== 1 ||
      manifest.host_permissions[0] !== '<all_urls>'
    ) {
      throw new Error(`[personal] host_permissions must be ['<all_urls>']`);
    }
    if (manifest.optional_host_permissions !== undefined) {
      throw new Error('[personal] optional_host_permissions must be omitted');
    }
    if (Array.isArray(manifest.permissions) && manifest.permissions.includes('activeTab')) {
      throw new Error('[personal] activeTab permission must not be included');
    }
  } else {
    if (!Array.isArray(manifest.host_permissions) || manifest.host_permissions.includes('<all_urls>')) {
      throw new Error('[public] host_permissions must not include <all_urls>');
    }
    if (
      !Array.isArray(manifest.optional_host_permissions) ||
      !manifest.optional_host_permissions.includes('https://*/*') ||
      !manifest.optional_host_permissions.includes('http://*/*')
    ) {
      throw new Error('[public] optional_host_permissions must include http/https wildcards');
    }
  }
  if (browser === 'firefox') {
    if (manifest.minimum_chrome_version !== undefined || manifest.version_name !== undefined) {
      throw new Error(`[${profile}] firefox manifest must omit minimum_chrome_version and version_name`);
    }
    if (!Array.isArray(manifest.background?.scripts) || manifest.background.scripts.length === 0) {
      throw new Error(`[${profile}] firefox manifest must define background.scripts`);
    }
    if (manifest.background?.service_worker !== undefined) {
      throw new Error(`[${profile}] firefox manifest must omit background.service_worker`);
    }
    if (!manifest.browser_specific_settings?.gecko?.id) {
      throw new Error(`[${profile}] firefox manifest must define browser_specific_settings.gecko.id`);
    }
  } else if (browser === 'safari') {
    if (manifest.minimum_chrome_version !== undefined || manifest.version_name !== undefined) {
      throw new Error(`[${profile}] safari manifest must omit minimum_chrome_version and version_name`);
    }
    if (
      Array.isArray(manifest.content_scripts) &&
      manifest.content_scripts.some((entry) => entry.match_origin_as_fallback !== undefined)
    ) {
      throw new Error(`[${profile}] safari manifest must omit match_origin_as_fallback`);
    }
  }
}

const pkg = await readJson('package.json');
const baseManifest = await readJson('manifest.json');

if (!pkg.version || pkg.version !== baseManifest.version) {
  throw new Error(
    `Version mismatch: package.json (${pkg.version}) !== manifest.json (${baseManifest.version})`,
  );
}

const expectedTag = getArg('--expected-tag=');
if (expectedTag && expectedTag !== `v${pkg.version}`) {
  throw new Error(`Release tag (${expectedTag}) does not match package/manifest version (v${pkg.version})`);
}

if (process.argv.includes('--version-only')) {
  console.log(`Version verified: v${pkg.version}`);
  process.exit(0);
}

const browser = getArg('--browser=') ?? 'chrome';
if (!['chrome', 'firefox', 'safari'].includes(browser)) {
  throw new Error(`Unknown browser target: ${browser}`);
}
const personalDir = getArg('--personal-dir=') ?? 'dist/personal';
const publicDir = getArg('--public-dir=') ?? 'dist/public';

await verifyProfile(personalDir, pkg.version, 'personal', browser);
await verifyProfile(publicDir, pkg.version, 'public', browser);

console.log(`Build artifacts and permission profiles verified for v${pkg.version} (${browser})`);
