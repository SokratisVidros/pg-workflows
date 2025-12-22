import path from 'node:path';
import { defineConfig } from 'vitest/config';
import type { ViteUserConfig } from 'vitest/config';

const config: ViteUserConfig = defineConfig({
  test: {
    environment: 'node',
    pool: 'threads',
    reporters: [['default', { summary: true }]],
    testTimeout: 20000,
    bail: 1,
  },
});

export default config;
