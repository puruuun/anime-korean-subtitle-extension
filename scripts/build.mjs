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
const target = process.env.ANIMESUB_BUILD_TARGET ?? 'personal';
await writeFile(
  'dist/manifest.json',
  JSON.stringify(
    buildManifest(JSON.parse(await readFile('manifest.json', 'utf8')), target),
    null,
    2,
  ),
);
console.log('Permission profile: ' + target);
console.log('MV3 extension ready: dist/');
