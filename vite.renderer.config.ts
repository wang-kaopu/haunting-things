import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const backendTarget = "http://127.0.0.1:25808";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: 'src/renderer',
  resolve: {
    alias: {
      '@server': fromRoot('./src/server'),
      '@renderer': fromRoot('./src/renderer'),
      '@shared': fromRoot('./src/shared'),
      '@electron': fromRoot('./src/electron'),
    },
  },
  build: {
    outDir: fromRoot('./dist/renderer'),
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': backendTarget,
      '/login': backendTarget,
      '/logout': backendTarget,
      '/bridge': {
        target: backendTarget,
        ws: true,
      },
    },
  },
});
