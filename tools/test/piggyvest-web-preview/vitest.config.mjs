import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
export default {
  root,
  envFile: false,
  envPrefix: [],
  publicDir: false,
  cacheDir: resolve(root, '.vite-tests'),
  resolve: {
    alias: { '@': resolve(root, '../../../apps/web/src') },
    dedupe: ['react', 'react-dom'],
  },
  css: { postcss: { plugins: [] } },
  test: {
    environment: 'jsdom',
    include: [
      'app.test.tsx',
      'cancellation-*.test.ts',
      'cancellation-*.test.tsx',
    ],
    maxWorkers: 1,
  },
};
