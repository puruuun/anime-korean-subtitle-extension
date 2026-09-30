import { build } from 'vite';
import { copyFile } from 'node:fs/promises';
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
await copyFile('manifest.json', 'dist/manifest.json');
console.log('MV3 extension ready: dist/');
