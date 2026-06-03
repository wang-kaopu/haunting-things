import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  plugins: [react()],
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
  },
});
