import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      // exceljs (dynamic import, ~940 kB) and vendor-xlsx (~333 kB) are intentionally
      // large vendor chunks that the browser caches after first load — raise the limit
      // so the warning only fires if something unexpected ends up in a hot-path chunk.
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-auth':   ['@auth0/auth0-react'],
            'vendor-motion': ['motion/react'],
            'vendor-xlsx':   ['xlsx'],
            'vendor-lucide': ['lucide-react'],
          },
        },
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      proxy: {
        '/api': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
      },
    },
  };
});
