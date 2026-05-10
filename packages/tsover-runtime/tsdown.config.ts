import { defineConfig } from 'tsdown';

export default defineConfig({
  format: ['esm'],
  entry: ['src/index.ts'],
  copy: ['src/disable.d.ts'],
  platform: 'neutral',
  target: false,
  unbundle: true,
  sourcemap: false,
});
