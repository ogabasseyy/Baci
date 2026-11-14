import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const require = createRequire(import.meta.url);
const libraryPackage = require.resolve('@testing-library/react/package.json');
const libraryMetadata = require(libraryPackage) as { module?: string };
if (!libraryMetadata.module)
  throw new Error('Testing Library must publish an ESM entry');

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@testing-library\/react$/,
        replacement: resolve(dirname(libraryPackage), libraryMetadata.module),
      },
      ...[
        'react',
        'react/jsx-runtime',
        'react/jsx-dev-runtime',
        'react-dom',
        'react-dom/client',
        'react-dom/test-utils',
      ].map((name) => ({
        find: new RegExp(`^${name}$`),
        replacement: require.resolve(name),
      })),
    ],
    dedupe: ['react', 'react-dom', '@testing-library/react'],
  },
  ssr: { noExternal: true },
  test: { environment: 'jsdom', passWithNoTests: false },
});
