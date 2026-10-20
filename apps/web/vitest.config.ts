import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const appRequire = createRequire(path.join(__dirname, 'package.json'));

function resolveTestingLibraryReactPath() {
  try {
    return require.resolve('@testing-library/react');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to resolve @testing-library/react: ${message}`);
  }
}

const testingLibraryReactPath = resolveTestingLibraryReactPath();
const reactPath = appRequire.resolve('react');
const reactJsxRuntimePath = appRequire.resolve('react/jsx-runtime');
const reactJsxDevRuntimePath = appRequire.resolve('react/jsx-dev-runtime');
const reactDomPath = appRequire.resolve('react-dom');
const reactDomClientPath = appRequire.resolve('react-dom/client');
const reactDomTestUtilsPath = appRequire.resolve('react-dom/test-utils');
const reactDomServerPath = appRequire.resolve('react-dom/server');
const sharedPackagePath = path.resolve(__dirname, '../../packages/shared/src');
const sharedAliases = [
  {
    find: /^@baci\/shared$/,
    replacement: path.join(sharedPackagePath, 'index.ts'),
  },
  {
    find: /^@baci\/shared\/types$/,
    replacement: path.join(sharedPackagePath, 'types/index.ts'),
  },
  {
    find: /^@baci\/shared\/constants$/,
    replacement: path.join(sharedPackagePath, 'constants/index.ts'),
  },
  {
    find: /^@baci\/shared\/imei$/,
    replacement: path.join(sharedPackagePath, 'imei/index.ts'),
  },
  {
    find: /^@baci\/shared\/contracts$/,
    replacement: path.join(sharedPackagePath, 'contracts/index.ts'),
  },
  {
    find: /^@baci\/shared\/lib$/,
    replacement: path.join(sharedPackagePath, 'lib/index.ts'),
  },
  {
    find: /^@baci\/shared\/schemas$/,
    replacement: path.join(sharedPackagePath, 'schemas/index.ts'),
  },
  {
    find: /^@baci\/shared\/schemas\/merchant-settings$/,
    replacement: path.join(sharedPackagePath, 'schemas/merchant-settings.ts'),
  },
  {
    find: /^@baci\/shared\/receipt$/,
    replacement: path.join(sharedPackagePath, 'receipt/index.ts'),
  },
  {
    find: /^@baci\/shared\/storefront$/,
    replacement: path.join(sharedPackagePath, 'storefront/index.ts'),
  },
  {
    find: /^@baci\/shared\/gmc-feed$/,
    replacement: path.join(sharedPackagePath, 'gmc-feed/index.ts'),
  },
];

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(__dirname, './src') },
      { find: '@testing-library/react', replacement: testingLibraryReactPath },
      { find: /^react$/, replacement: reactPath },
      { find: /^react\/jsx-runtime$/, replacement: reactJsxRuntimePath },
      { find: /^react\/jsx-dev-runtime$/, replacement: reactJsxDevRuntimePath },
      { find: /^react-dom$/, replacement: reactDomPath },
      { find: /^react-dom\/client$/, replacement: reactDomClientPath },
      { find: /^react-dom\/test-utils$/, replacement: reactDomTestUtilsPath },
      { find: /^react-dom\/server$/, replacement: reactDomServerPath },
      ...sharedAliases,
    ],
    dedupe: ['react', 'react-dom', '@testing-library/react'],
  },
  ssr: {
    noExternal: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    testTimeout: 10_000,
    setupFiles: [path.join(__dirname, 'vitest.setup.ts')],
    // Cap worker parallelism when running locally (e.g. the pre-push hook) to
    // avoid OOM/SIGTERM under memory pressure — each jsdom worker is heavy and
    // the full suite spawns one per core. CI (process.env.CI) keeps full
    // parallelism for speed.
    ...(process.env.CI ? {} : { maxWorkers: '50%', minWorkers: 1 }),
    alias: {
      '@/app/(platform)/onboarding/actions': path.resolve(
        __dirname,
        './src/app/(platform)/onboarding/__mocks__/actions.ts'
      ),
    },
    server: {
      deps: {
        inline: true,
      },
    },
  },
});
