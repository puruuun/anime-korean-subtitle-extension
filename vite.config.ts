import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  build: {
    target: 'chrome120',
    outDir: 'dist',
    rollupOptions: {
      input: {
        popup: 'popup.html',
        settings: 'settings.html',
        serviceWorker: 'src/background/serviceWorker.ts',
      },
      output: { entryFileNames: '[name].js', chunkFileNames: 'chunks/[name]-[hash].js' },
    },
  },
});
