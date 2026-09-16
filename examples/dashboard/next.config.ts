import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const dashboardDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dashboardDir, '../..');
const uiSrc = path.join(repoRoot, 'packages/ui/src');

// Compile the workspace UI package from source so component edits Fast Refresh
// without a `dist/` rebuild. Published consumers still resolve `dist/` via exports.
// Turbopack aliases are relative to this Next app; webpack wants absolute paths.
const turbopackAliases = {
  '@pg-workflows/ui/styles.css': '../../packages/ui/src/styles.css',
  '@pg-workflows/ui/server': '../../packages/ui/src/server/index.ts',
  '@pg-workflows/ui/next': '../../packages/ui/src/next/index.ts',
  '@pg-workflows/ui/client': '../../packages/ui/src/client.ts',
  '@pg-workflows/ui': '../../packages/ui/src/index.ts',
};

const webpackAliases = {
  '@pg-workflows/ui/styles.css': path.join(uiSrc, 'styles.css'),
  '@pg-workflows/ui/server': path.join(uiSrc, 'server/index.ts'),
  '@pg-workflows/ui/next': path.join(uiSrc, 'next/index.ts'),
  '@pg-workflows/ui/client': path.join(uiSrc, 'client.ts'),
  '@pg-workflows/ui$': path.join(uiSrc, 'index.ts'),
};

const config: NextConfig = {
  transpilePackages: ['@pg-workflows/ui'],
  // `pg` and `pg-boss` are Node-native and must not be bundled into the
  // server output; the engine reaches for them at runtime.
  serverExternalPackages: ['pg', 'pg-boss', 'pg-workflows'],
  outputFileTracingRoot: repoRoot,
  agentRules: false,
  turbopack: {
    root: repoRoot,
    resolveAlias: turbopackAliases,
  },
  webpack: (webpackConfig) => {
    webpackConfig.resolve.alias = {
      ...webpackConfig.resolve.alias,
      ...webpackAliases,
    };
    return webpackConfig;
  },
};

export default config;
