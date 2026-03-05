import { defineConfig } from 'bunup'

const shared = {
  format: ['esm', 'cjs'] as const,
  minify: false,
  sourcemap: 'linked' as const,
  target: 'node' as const,
  exports: false as const,
}

export default defineConfig([
  {
    name: 'core',
    entry: 'src/index.ts',
    ...shared,
  },
  {
    name: 'email-plugin',
    entry: 'src/plugins/email/index.ts',
    outDir: 'dist/plugins/email',
    ...shared,
  },
])
