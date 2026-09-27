// Shared route tables for the app route shell safety suite.
// Extracted so the test file stays within the 300-line modularity rule.

export const ROUTE_MODULE_EXTENSION_PATTERN =
  /\.(?:(?:android|ios|native|web)\.)?(ts|tsx|js|jsx)$/;
export const ROUTE_PLATFORM_SEGMENT_PATTERN =
  /\.(android|ios|native|web)\.(ts|tsx|js|jsx)$/;
export const API_ROUTE_MODULE_PATTERN = /\+api\.(ts|tsx|js|jsx)$/;
export const DYNAMIC_ROUTE_MODULE_PATTERN =
  /^(?:\[[a-zA-Z0-9_-]+\]|\[\.\.\.[a-zA-Z0-9_-]+\]|\[\[\.\.\.[a-zA-Z0-9_-]+\]\])\.(ts|tsx|js|jsx)$/;
export const LAYOUT_ROUTE_MODULE_PATTERN = /^_layout\.(ts|tsx|js|jsx)$/;
export const INDEX_ROUTE_MODULE_PATTERN = /^index\.(ts|tsx|js|jsx)$/;
export const SHELL_JSX_PATTERN = /<StorefrontScreenShell(?=[\s/>])/;
export const SHELL_DELEGATE_MODULES = new Map<
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
  [
    'repairs/status.tsx',
    {
      modulePath: '../components/repairs/RepairStatusScreen.tsx',
      routeJsxPattern: /<RepairStatusScreen(?=[\s/>])/,
    },
  ],
]);

export type RouteModule = {
  actualPath: string;
  normalizedPath: string;
};
export const EXPO_ROUTER_SPECIAL_FILES = new Set([
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

export const EXPLICIT_STATIC_ROUTES = new Set([
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
  'repairs/status.tsx',
  'search.tsx',
  'utilities/history.tsx',
  'wallet/manage-cards.tsx',
  'wallet/savings/start.tsx',
  'wallet/usdt.tsx',
]);

// Decreasing baseline: every route listed here currently does not render
// StorefrontScreenShell. As routes migrate, this list must shrink.
export const SHELL_EXEMPT_ROUTES = new Set([
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
