const API_SOURCE_ROOT = 'apps/web/src/app/api/';

const STOREFRONT_API_SOURCE_PATHS = new Set([
  'ai/grade-device',
  'analytics/facebook-capi',
  'attr',
  'blog/exit-preview',
  'blog/feed/[merchantSlug]',
  'blog/preview',
  'cart/validate',
  'chat/santa',
  'chat/santa/product',
  'chat',
  'csrf',
  'events',
  'forms/submit',
  'newsletter/subscribe',
  'google-places/reviews',
  'ogabassey/pdp-lcp-image/[productSlug]',
  'ogabassey/pdp-lcp-image/profile/[profile]/[productSlug]',
  'orders',
  'orders/credit-direct/client-completion',
  'orders/reuse',
  // Merchant admin order PATCH/GET is not a customer storefront edge surface.
  'orders/update-payment-ref',
  'places/autocomplete',
  'places/details',
  'payments/initialize',
  'payments/status',
  'payments/verify',
  'payments/credit-direct/sign',
  'payments/klump/record',
  'products/count',
  'quiz/leaderboard',
  'quiz/events',
  'quiz/attempts/start',
  'quiz/attempts/[attemptId]/answers',
  'reviews',
  'reviews/[id]/helpful',
  'search',
  'search/autocomplete',
  'shipping/quotes',
  'shipping/locations',
  'vtu/billers',
  'vtu/verify',
  'vtu/checkout/initialize',
  'vtu/checkout/wallet-only',
  'wishlist',
  'wishlist/check',
  'agentic/carts',
  'agentic/carts/[id]',
  'agentic/carts/[id]/cancel',
  'agentic/carts/[id]/checkout',
  'agentic/catalog/lookup',
  'agentic/catalog/product',
  'agentic/catalog/search',
  'agentic/checkout-sessions',
  'agentic/checkout-sessions/[id]',
  'agentic/checkout-sessions/[id]/cancel',
  'agentic/checkout-sessions/[id]/complete',
  'agentic/checkout_sessions',
  'agentic/checkout_sessions/[id]',
  'agentic/checkout_sessions/[id]/cancel',
  'agentic/checkout_sessions/[id]/complete',
  'agentic/orders/[id]',
]);

/** Limits edge-origin API inventory to reviewed customer storefront routes. */
export function isStorefrontRequiredApiSourcePath(
  sourcePath: string,
  apiRoot = API_SOURCE_ROOT
): boolean {
  const routeSuffixPattern = /\/route\.[tj]sx?$/;
  const normalizedRoot = `${apiRoot.replace(/\/$/, '')}/`;
  if (
    !sourcePath.startsWith(normalizedRoot) ||
    !routeSuffixPattern.test(sourcePath)
  )
    return false;
  const relativePath = sourcePath
    .slice(normalizedRoot.length)
    .replace(routeSuffixPattern, '');
  return (
    relativePath.startsWith('storefront/') ||
    STOREFRONT_API_SOURCE_PATHS.has(relativePath)
  );
}
