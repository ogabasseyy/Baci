import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

function resolveTestingLibraryReactPath() {
  // Use the package entry instead of an internal dist path to avoid brittle resolution.
  try {
    // ESM lets Vite apply the app's React aliases. CJS require() would load
    // the testing library's separate hoisted peer and trigger invalid hooks.
    const packageJsonPath = require.resolve(
      '@testing-library/react/package.json'
    );
    const metadata = require(packageJsonPath) as { module?: string };
    if (!metadata.module)
      throw new Error('Testing Library must publish an ESM entry');
    return path.resolve(path.dirname(packageJsonPath), metadata.module);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to resolve @testing-library/react ESM entry: ${message}`
    );
  }
}

const testingLibraryReactPath = resolveTestingLibraryReactPath();
const reactPath = require.resolve('react');
const reactJsxRuntimePath = require.resolve('react/jsx-runtime');
const reactJsxDevRuntimePath = require.resolve('react/jsx-dev-runtime');
const reactDomPath = require.resolve('react-dom');
const reactDomClientPath = require.resolve('react-dom/client');
const reactDomTestUtilsPath = require.resolve('react-dom/test-utils');
const reactNativeWebPackagePath = require.resolve(
  'react-native-web/package.json'
);
const reactNativeWebMetadata = require(reactNativeWebPackagePath) as {
  module: string;
};
const reactNativeWebPath = path.resolve(
  path.dirname(reactNativeWebPackagePath),
  reactNativeWebMetadata.module
);
const reactNativePhoneInputMockPath = path.resolve(
  __dirname,
  'test/mocks/react-native-phone-number-input.tsx'
);
const reactNativeGooglePlacesMockPath = path.resolve(
  __dirname,
  'test/mocks/react-native-google-places-autocomplete.tsx'
);
const reactNativeVectorIconMockPath = path.resolve(
  __dirname,
  'test/mocks/react-native-vector-icon.tsx'
);

export default defineConfig({
  define: {
    __DEV__: true,
  },
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
  resolve: {
    alias: [
      { find: '@', replacement: __dirname },
      {
        find: /^@baci\/shared\/test-fixtures\/builder-ai-edit$/,
        replacement: path.resolve(
          __dirname,
          '../../packages/shared/src/test-fixtures/builder-ai-edit.ts'
        ),
      },
      {
        find: /^@baci\/shared\/contracts$/,
        replacement: path.resolve(
          __dirname,
          '../../packages/shared/src/contracts/index.ts'
        ),
      },
      {
        find: '@baci/shared',
        replacement: path.resolve(
          __dirname,
          '../../packages/shared/src/index.ts'
        ),
      },
      {
        find: /^@testing-library\/react$/,
        replacement: testingLibraryReactPath,
      },
      { find: /^react$/, replacement: reactPath },
      { find: /^react\/jsx-runtime$/, replacement: reactJsxRuntimePath },
      { find: /^react\/jsx-dev-runtime$/, replacement: reactJsxDevRuntimePath },
      { find: /^react-dom$/, replacement: reactDomPath },
      { find: /^react-dom\/client$/, replacement: reactDomClientPath },
      { find: /^react-dom\/test-utils$/, replacement: reactDomTestUtilsPath },
      { find: /^react-native$/, replacement: reactNativeWebPath },
      {
        find: /^react-native-phone-number-input$/,
        replacement: reactNativePhoneInputMockPath,
      },
      {
        find: /^react-native-google-places-autocomplete$/,
        replacement: reactNativeGooglePlacesMockPath,
      },
      {
        find: /^@react-native-vector-icons\/(ionicons|fontawesome|feather)(\/static)?$/,
        replacement: reactNativeVectorIconMockPath,
      },
    ],
    dedupe: ['react', 'react-dom', 'react-native-web'],
  },
  ssr: {
    noExternal: [
      '@tanstack/react-query',
      '@testing-library/react',
      'react',
      'react-dom',
      'react-native-web',
    ],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    // Keep the Expo/jsdom suite from exhausting fork startup capacity when
    // Turborepo runs package tests concurrently.
    maxWorkers: 4,
    server: {
      deps: {
        // Prevent vitest from parsing native packages (Flow/JSX in .js files)
        inline: [
          /@tanstack\/react-query/,
          /@testing-library\/react/,
          /^react$/,
          /^react-dom$/,
          /^react-native-web$/,
        ],
        external: [/expo-linear-gradient/, /react-native\//],
      },
    },
  },
});
