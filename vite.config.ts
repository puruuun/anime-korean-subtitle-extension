import { defineConfig, loadEnv } from 'vite';
export default defineConfig(({ mode }) => ({
  define: { __JIMAKU_API_KEY__: JSON.stringify(loadEnv(mode, '.', '').JIMAKU_API_KEY ?? '') },
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
}));
