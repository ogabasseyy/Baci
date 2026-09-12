import { readdirSync } from 'node:fs';
import path from 'node:path';

const APP_ROOT = path.resolve(__dirname, '../../app');

const ROUTE_MODULE_EXTENSION_PATTERN =
  /\.(?:(?:android|ios|native|web)\.)?(ts|tsx|js|jsx)$/;
const ROUTE_PLATFORM_SEGMENT_PATTERN =
  /\.(android|ios|native|web)\.(ts|tsx|js|jsx)$/;
const EXPO_ROUTER_SPECIAL_FILES = new Set([
  '+html.ts',
  '+html.tsx',
  '+html.js',
  '+html.jsx',
  '+middleware.ts',
  '+middleware.tsx',
  '+middleware.js',
  '+middleware.jsx',
  '+native-intent.ts',
  '+native-intent.tsx',
  '+native-intent.js',
  '+native-intent.jsx',
  '+not-found.ts',
  '+not-found.tsx',
  '+not-found.js',
  '+not-found.jsx',
]);
const EXPLICIT_STATIC_ROUTES = new Set([
  '(tabs)/account.tsx',
  '(tabs)/cart-tab.tsx',
  '(tabs)/categories.tsx',
  '(tabs)/saved.tsx',
  '(tabs)/wallet.tsx',
  'account/verify.tsx',
  'auth/callback.tsx',
  'cart.tsx',
  'auth/login.tsx',
  'checkout.tsx',
  'notifications.tsx',
  'order-success.tsx',
  'profile/delete-account.tsx',
  'profile/edit.tsx',
  'quiz/prize-checkout-simulation.tsx',
  'search.tsx',
  'utilities/history.tsx',
  'wallet/manage-cards.tsx',
  'wallet/savings/start.tsx',
  'wallet/usdt.tsx',
]);

function collectModuleFiles(currentPath: string): string[] {
  return readdirSync(currentPath, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(currentPath, entry.name);

    if (entry.isDirectory()) {
      return collectModuleFiles(entryPath);
    }

    if (!ROUTE_MODULE_EXTENSION_PATTERN.test(entry.name)) {
      return [];
    }

    const relativePath = path.relative(APP_ROOT, entryPath);
    return [relativePath.split(path.sep).join('/')];
  });
}

function isRouteFile(relativePath: string): boolean {
  const fileName = path.basename(relativePath);
  const routeFileName = fileName.replace(ROUTE_PLATFORM_SEGMENT_PATTERN, '.$2');
  const routePath = relativePath.replace(ROUTE_PLATFORM_SEGMENT_PATTERN, '.$2');

  if (EXPO_ROUTER_SPECIAL_FILES.has(routeFileName)) {
    return true;
  }

  if (/^_layout\.(ts|tsx|js|jsx)$/.test(routeFileName)) {
    return true;
  }

  if (/^index\.(ts|tsx|js|jsx)$/.test(routeFileName)) {
    return true;
  }

  if (/^.+\+api\.(ts|tsx|js|jsx)$/.test(routeFileName)) {
    return true;
  }

  if (
    /^(?:\[[a-zA-Z0-9_-]+\]|\[\.\.\.[a-zA-Z0-9_-]+\]|\[\[\.\.\.[a-zA-Z0-9_-]+\]\])\.(ts|tsx|js|jsx)$/.test(
      routeFileName
    )
  ) {
    return true;
  }

  return EXPLICIT_STATIC_ROUTES.has(routePath);
}

describe('app route tree safety', () => {
  it.each([
    ['+html.tsx'],
    ['+middleware.ts'],
    ['+native-intent.tsx'],
    ['+not-found.tsx'],
    ['_layout.tsx'],
    ['_layout.web.tsx'],
    ['index.tsx'],
    ['index.ios.tsx'],
    ['category/[slug].tsx'],
    ['category/[slug].android.tsx'],
    ['orders/[...params].tsx'],
    ['utilities/[[...optional]].tsx'],
    ['api/products+api.ts'],
    ['api/products+api.web.ts'],
    ['api/inventory.refresh+api.tsx'],
    ['search.tsx'],
    ['search.native.tsx'],
  ])('allows valid Expo Router module %s', (routeModule) => {
    expect(isRouteFile(routeModule)).toBe(true);
  });

  it('keeps the expo-router app directory route-only', () => {
    const nonRouteFiles = collectModuleFiles(APP_ROOT).filter(
      (filePath) => !isRouteFile(filePath)
    );

    if (nonRouteFiles.length > 0) {
      throw new Error(
        [
          'Found non-route module files under apps/mobile-storefront/app:',
          ...nonRouteFiles.map((filePath) => `- ${filePath}`),
          '',
          'Move route tests to apps/mobile-storefront/__tests__/app/<route>/.',
          'Move reusable UI to components/, stateful hooks to hooks/, and pure helpers/config to lib/ or feature folders outside app/.',
          'Expo Router treats module files under app/ as route candidates, so app/ must stay route-only.',
        ].join('\n')
      );
    }

    expect(nonRouteFiles).toEqual([]);
  });
});
