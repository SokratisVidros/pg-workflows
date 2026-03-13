import type { ViteUserConfig } from 'vitest/config';
import { defineConfig } from 'vitest/config';

const config: ViteUserConfig = defineConfig({
  test: {
    environment: 'node',
    pool: 'threads',
    reporters: [['default', { summary: true }]],
    testTimeout: 20000,
    bail: 1,
    exclude: ['**/integration.test.ts', '**/node_modules/**'],
  },
});

export default config;
