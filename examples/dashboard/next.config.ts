import type { NextConfig } from 'next';

const config: NextConfig = {
  // `pg` and `pg-boss` are Node-native and must not be bundled into the
  // server output; the engine reaches for them at runtime.
  serverExternalPackages: ['pg', 'pg-boss', 'pg-workflows'],
};

export default config;
