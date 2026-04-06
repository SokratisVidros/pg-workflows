import type { ViteUserConfig } from 'vitest/config';
import { defineConfig } from 'vitest/config';

const config: ViteUserConfig = defineConfig({
  test: {
    environment: 'node',
    pool: 'forks',
    reporters: [['default', { summary: true }]],
    testTimeout: 60000,
    bail: 1,
    include: ['src/integration.test.ts', 'src/migration-lock.integration.test.ts'],
  },
});

export default config;
