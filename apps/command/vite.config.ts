import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // The shared contract is consumed as TypeScript source, so a change
      // to an event name shows up here as a type error immediately.
      '@safeher/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
  server: { port: 5173 },
  // The .env at the repo root is shared by all four surfaces.
  envDir: path.resolve(__dirname, '../..'),
});
