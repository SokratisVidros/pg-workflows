import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Builds the static bundle the `npx` standalone serves. This is the one place
 * the package *does* bundle: the standalone is a plain SPA with no React Server
 * Components boundary, so the `'use client'` directives the library build
 * preserves are meaningless here and Rollup is free to drop them.
 */
export default defineConfig({
  root: 'standalone',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../dist/standalone',
    emptyOutDir: true,
  },
});
