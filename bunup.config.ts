import { defineConfig } from 'bunup';
import { exports } from 'bunup/plugins';

export default defineConfig({
  entry: ['src/index.ts', 'src/client.entry.ts'],
  format: ['esm', 'cjs'],
  minify: false,
  sourcemap: 'linked',
  target: 'node',
  plugins: [exports()],
});
