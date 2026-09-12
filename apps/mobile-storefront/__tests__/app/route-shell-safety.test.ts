import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const APP_ROOT = path.resolve(__dirname, '../../app');
const ROUTE_MODULE_EXTENSION_PATTERN =
  /\.(?:(?:android|ios|native|web)\.)?(ts|tsx|js|jsx)$/;
const ROUTE_PLATFORM_SEGMENT_PATTERN =
  /\.(android|ios|native|web)\.(ts|tsx|js|jsx)$/;
const API_ROUTE_MODULE_PATTERN = /\+api\.(ts|tsx|js|jsx)$/;
const DYNAMIC_ROUTE_MODULE_PATTERN =
  /^(?:\[[a-zA-Z0-9_-]+\]|\[\.\.\.[a-zA-Z0-9_-]+\]|\[\[\.\.\.[a-zA-Z0-9_-]+\]\])\.(ts|tsx|js|jsx)$/;
const LAYOUT_ROUTE_MODULE_PATTERN = /^_layout\.(ts|tsx|js|jsx)$/;
const INDEX_ROUTE_MODULE_PATTERN = /^index\.(ts|tsx|js|jsx)$/;
const SHELL_JSX_PATTERN = /<StorefrontScreenShell(?=[\s/>])/;
const SHELL_DELEGATE_MODULES = new Map<
  string,
  { modulePath: string; routeJsxPattern: RegExp }
>([
  [
    'unlock-orders/index.tsx',
    {
      modulePath: '../components/imei-check/unlock-orders-screen.tsx',
      routeJsxPattern: /<UnlockOrdersScreen(?=[\s/>])/,
    },
  ],
  [
    'wallet/index.tsx',
    {
      modulePath: '../components/wallet/WalletScreenView.tsx',
      routeJsxPattern: /<WalletScreen(?=[\s/>])/,
    },
  ],
  [
    'wallet/usdt.tsx',
    {
      modulePath: '../components/wallet/UsdtWalletFundingScreen.tsx',
      routeJsxPattern: /<UsdtWalletFundingScreen(?=[\s/>])/,
    },
  ],
]);

type RouteModule = {
  actualPath: string;
  normalizedPath: string;
};
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

// Decreasing baseline: every route listed here currently does not render
// StorefrontScreenShell. As routes migrate, this list must shrink.
const SHELL_EXEMPT_ROUTES = new Set([
  '(tabs)/cart-tab.tsx',
  '(tabs)/index.tsx',
  '(tabs)/wallet.tsx',
  'account/verify.tsx',
  'addresses/[id].tsx',
  'auth/login.tsx',
  'bank-transfer/index.tsx',
  'bnpl-checkout/index.tsx',
  'cart.tsx',
  'checkout.tsx',
  'compare/index.tsx',
  'crypto-payment/index.tsx',
  'faq/index.tsx',
  'order-success.tsx',
  'orders/[id].tsx',
  'product/[slug].tsx',
  'profile/edit.tsx',
  'saved/index.tsx',
  'search.tsx',
  'track-order/index.tsx',
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

function normalizeRouteModulePath(relativePath: string) {
  return relativePath.replace(ROUTE_PLATFORM_SEGMENT_PATTERN, '.$2');
}

function toRouteModule(relativePath: string): RouteModule {
  return {
    actualPath: relativePath,
    normalizedPath: normalizeRouteModulePath(relativePath),
  };
}

function validateRouteFile(relativePath: string): void {
  const routePath = normalizeRouteModulePath(relativePath);
  const fileName = path.basename(routePath);

  if (EXPO_ROUTER_SPECIAL_FILES.has(fileName)) {
    return;
  }

  if (LAYOUT_ROUTE_MODULE_PATTERN.test(fileName)) {
    return;
  }

  if (INDEX_ROUTE_MODULE_PATTERN.test(fileName)) {
    return;
  }

  if (API_ROUTE_MODULE_PATTERN.test(fileName)) {
    return;
  }

  if (DYNAMIC_ROUTE_MODULE_PATTERN.test(fileName)) {
    return;
  }

  if (EXPLICIT_STATIC_ROUTES.has(routePath)) {
    return;
  }

  throw new Error(
    [
      `Unclassified app route module: ${routePath}`,
      'If this is a new static screen, add it to EXPLICIT_STATIC_ROUTES so the StorefrontScreenShell safety check covers it.',
      'If this is support code, move it out of app/ so Expo Router does not discover it as a route.',
    ].join('\n')
  );
}

function isShellCheckRoute(routePath: string) {
  const fileName = path.basename(routePath);
  if (EXPO_ROUTER_SPECIAL_FILES.has(fileName)) return false;
  if (LAYOUT_ROUTE_MODULE_PATTERN.test(fileName)) return false;
  return !API_ROUTE_MODULE_PATTERN.test(fileName);
}

function moduleUsesStorefrontScreenShell(absolutePath: string) {
  const source = readFileSync(absolutePath, 'utf8');
  return SHELL_JSX_PATTERN.test(source);
}

function routeUsesStorefrontScreenShell(routeModule: RouteModule) {
  const absolutePath = path.join(APP_ROOT, routeModule.actualPath);
  const routeSource = readFileSync(absolutePath, 'utf8');
  if (SHELL_JSX_PATTERN.test(routeSource)) {
    return true;
  }

  const shellDelegate = SHELL_DELEGATE_MODULES.get(routeModule.normalizedPath);
  if (!shellDelegate?.routeJsxPattern.test(routeSource)) {
    return false;
  }

  return moduleUsesStorefrontScreenShell(
    path.resolve(APP_ROOT, shellDelegate.modulePath)
  );
}

describe('app route shell safety', () => {
  it('keeps StorefrontScreenShell coverage from regressing', () => {
    const moduleFiles = collectModuleFiles(APP_ROOT);
    moduleFiles.forEach(validateRouteFile);

    const routeFiles = moduleFiles
      .map(toRouteModule)
      .filter((routeModule) => isShellCheckRoute(routeModule.normalizedPath));

    const routePathSet = new Set(
      routeFiles.map((routeModule) => routeModule.normalizedPath)
    );

    const routesWithoutShell = routeFiles
      .filter((routeModule) => !routeUsesStorefrontScreenShell(routeModule))
      .map((routeModule) => routeModule.normalizedPath);

    const routeModulesByPath = routeFiles.reduce(
      (modulesByPath, routeModule) => {
        const routeModules =
          modulesByPath.get(routeModule.normalizedPath) ?? [];
        routeModules.push(routeModule);
        modulesByPath.set(routeModule.normalizedPath, routeModules);
        return modulesByPath;
      },
      new Map<string, RouteModule[]>()
    );

    const unexpectedRoutesWithoutShell = routesWithoutShell.filter(
      (routePath) => !SHELL_EXEMPT_ROUTES.has(routePath)
    );

    const staleExemptions = [...SHELL_EXEMPT_ROUTES]
      .filter((routePath) => routePathSet.has(routePath))
      .filter((routePath) => {
        const routeModules = routeModulesByPath.get(routePath);
        if (!routeModules) {
          throw new Error(
            `Route module index missing entry for shell exemption: ${routePath}`
          );
        }
        return routeModules.every(routeUsesStorefrontScreenShell);
      });

    const orphanedExemptions = [...SHELL_EXEMPT_ROUTES].filter(
      (routePath) => !routePathSet.has(routePath)
    );

    if (
      unexpectedRoutesWithoutShell.length > 0 ||
      staleExemptions.length > 0 ||
      orphanedExemptions.length > 0
    ) {
      throw new Error(
        [
          'Storefront route shell safety check failed.',
          '',
          ...(unexpectedRoutesWithoutShell.length > 0
            ? [
                'Routes missing StorefrontScreenShell that are not in the exemption baseline:',
                ...unexpectedRoutesWithoutShell.map(
                  (routePath) => `- ${routePath}`
                ),
                '',
                'Either migrate the route to StorefrontScreenShell, or add a justified temporary exemption.',
                '',
              ]
            : []),
          ...(staleExemptions.length > 0
            ? [
                'Stale StorefrontScreenShell exemptions (route now uses shell; remove from SHELL_EXEMPT_ROUTES):',
                ...staleExemptions.map((routePath) => `- ${routePath}`),
                '',
              ]
            : []),
          ...(orphanedExemptions.length > 0
            ? [
                'Orphaned StorefrontScreenShell exemptions (route no longer exists; remove from SHELL_EXEMPT_ROUTES):',
                ...orphanedExemptions.map((routePath) => `- ${routePath}`),
              ]
            : []),
        ].join('\n')
      );
    }

    expect(unexpectedRoutesWithoutShell).toEqual([]);
    expect(staleExemptions).toEqual([]);
    expect(orphanedExemptions).toEqual([]);
  });
});
