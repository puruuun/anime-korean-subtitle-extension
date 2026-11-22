import { build } from 'vite';
import { readFile, writeFile } from 'node:fs/promises';
import { buildManifest } from './manifest-config.mjs';
await build();
for (const [name, entry] of [
  ['contentScript', 'src/content/contentScript.ts'],
  ['pageBridge', 'src/content/pageBridge.ts'],
]) {
  await build({
    configFile: false,
    build: {
      target: 'chrome120',
      outDir: 'dist',
      emptyOutDir: false,
      lib: { entry, name, formats: ['iife'], fileName: () => name + '.js' },
      rollupOptions: { output: { inlineDynamicImports: true } },
      minify: true,
    },
  });
}
const targetArg = process.argv.find((arg) => arg.startsWith('--target='));
const target = targetArg
  ? targetArg.slice('--target='.length)
  : (process.env.ANIMESUB_BUILD_TARGET ?? 'personal');
const browserArg = process.argv.find((arg) => arg.startsWith('--browser='));
const browser = browserArg
  ? browserArg.slice('--browser='.length)
  : (process.env.ANIMESUB_BUILD_BROWSER ?? 'chrome');
await writeFile(
  'dist/manifest.json',
  JSON.stringify(
    buildManifest(JSON.parse(await readFile('manifest.json', 'utf8')), target, browser),
    null,
    2,
  ),
);
console.log('Permission profile: ' + target);
console.log('Browser target: ' + browser);
console.log('MV3 extension ready: dist/');
