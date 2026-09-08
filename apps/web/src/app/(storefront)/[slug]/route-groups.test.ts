import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { expectNearestLoadingBoundaryOwnsFirstPaint } from './loading-route-test-utils';

const slugDirectory = dirname(fileURLToPath(import.meta.url));

const runtimeRouteManifest = [
  '(home)/page.tsx',
  '(home)/loading.tsx',
  '(catalog)/loading.tsx',
  '(catalog)/(listing)/compare/page.tsx',
  '(catalog)/(listing)/compare/loading.tsx',
  '(catalog)/(listing)/products/page.tsx',
  '(catalog)/(listing)/search/page.tsx',
  '(catalog)/(listing)/[category]/page.tsx',
  '(catalog)/(listing)/[category]/compare/[comparisonSlug]/page.tsx',
  '(catalog)/(listing)/[category]/compare/[comparisonSlug]/loading.tsx',
  '(catalog)/(listing)/[category]/best-under/[priceBandSlug]/page.tsx',
  '(catalog)/(listing)/[category]/best-under/[priceBandSlug]/loading.tsx',
  '(catalog)/(pdp)/products/[productSlug]/page.tsx',
  '(catalog)/(pdp)/products/[productSlug]/loading.tsx',
  '(catalog)/(pdp)/product/[productSlug]/page.tsx',
  '(catalog)/(pdp)/product/[productSlug]/loading.tsx',
  '(catalog)/(pdp)/[category]/[productSlug]/page.tsx',
  '(catalog)/(pdp)/[category]/[productSlug]/loading.tsx',
  '(blog)/blog/page.tsx',
  '(blog)/blog/[postSlug]/page.tsx',
  '(blog)/blog/[postSlug]/loading.tsx',
  '(content)/loading.tsx',
  '(content)/about/page.tsx',
  '(content)/contact/page.tsx',
  '(content)/faq/page.tsx',
  '(content)/privacy/page.tsx',
  '(content)/privacy-policy/page.tsx',
  '(content)/terms/page.tsx',
  '(content)/terms-of-service/page.tsx',
  '(content)/terms-and-conditions/page.tsx',
  '(content)/returns/page.tsx',
  '(content)/shipping/page.tsx',
  '(content)/warranty/page.tsx',
  '(content)/pages/about/page.tsx',
  '(content)/pages/blog/page.tsx',
  '(content)/pages/contact/page.tsx',
  '(content)/pages/faq/page.tsx',
  '(content)/pages/privacy/page.tsx',
  '(content)/pages/rewards/page.tsx',
  '(content)/pages/terms/page.tsx',
  '(commerce)/loading.tsx',
  '(commerce)/cart/page.tsx',
  '(commerce)/checkout/page.tsx',
  '(commerce)/checkout/bnpl/page.tsx',
  '(commerce)/checkout/crypto/page.tsx',
  '(commerce)/checkout/success/page.tsx',
  '(commerce)/order-success/page.tsx',
  '(commerce)/track-order/page.tsx',
  '(commerce)/wallet/page.tsx',
  '(commerce)/wishlist/page.tsx',
  '(customer)/loading.tsx',
  '(customer)/account/layout.tsx',
  '(customer)/account/page.tsx',
  '(customer)/account/addresses/page.tsx',
  '(customer)/account/callback/route.ts',
  '(customer)/account/login/page.tsx',
  '(customer)/account/orders/page.tsx',
  '(customer)/account/orders/[orderId]/page.tsx',
  '(customer)/account/orders/[orderId]/insurance/page.tsx',
  '(customer)/account/settings/page.tsx',
  '(customer)/delete-account/page.tsx',
  '(customer)/receipts/layout.tsx',
  '(customer)/receipts/page.tsx',
  '(utility)/imei-check/page.tsx',
  '(utility)/imei-check/loading.tsx',
  '(utility)/member-status/page.tsx',
  '(utility)/repair/page.tsx',
  '(utility)/repair/loading.tsx',
  '(utility)/repairs/page.tsx',
  '(utility)/repairs/loading.tsx',
  '(utility)/reviews/page.tsx',
  '(utility)/reviews/loading.tsx',
  '(utility)/swap/page.tsx',
];

const legacyRouteManifest = [
  'about/page.tsx',
  'contact/page.tsx',
  'faq/page.tsx',
  'privacy/page.tsx',
  'privacy-policy/page.tsx',
  'terms/page.tsx',
  'terms-of-service/page.tsx',
  'returns/page.tsx',
  'shipping/page.tsx',
  'warranty/page.tsx',
  'pages/about/page.tsx',
  'pages/blog/page.tsx',
  'pages/contact/page.tsx',
  'pages/faq/page.tsx',
  'pages/privacy/page.tsx',
  'pages/rewards/page.tsx',
  'pages/terms/page.tsx',
  'cart/page.tsx',
  'checkout/page.tsx',
  'checkout/bnpl/page.tsx',
  'checkout/crypto/page.tsx',
  'checkout/success/page.tsx',
  'order-success/page.tsx',
  'track-order/page.tsx',
  'wallet/page.tsx',
  'wishlist/page.tsx',
  'account/layout.tsx',
  'account/page.tsx',
  'account/addresses/page.tsx',
  'account/callback/route.ts',
  'account/login/page.tsx',
  'account/orders/page.tsx',
  'account/orders/[orderId]/page.tsx',
  'account/orders/[orderId]/insurance/page.tsx',
  'account/settings/page.tsx',
  'delete-account/page.tsx',
  'receipts/layout.tsx',
  'receipts/page.tsx',
  'imei-check/page.tsx',
  'member-status/page.tsx',
  'repair/page.tsx',
  'repairs/page.tsx',
  'reviews/page.tsx',
  'swap/page.tsx',
];

// Nested /compare, /repair, /repairs, and /imei-check loading shells are
// covered by colocated loading tests. This list stays on parent lazy-module
// boundaries that settle under `act()` without importing connection()-bound
// page graphs.
const firstPaintOwnershipManifest = [
  {
    routePath: '/blog/post-slug',
    pagePath: '(blog)/blog/[postSlug]/page.tsx',
    loadingPath: '(blog)/blog/[postSlug]/loading.tsx',
    label: 'Loading blog post',
    renderStrategy: 'lazy-module',
  },
  {
    routePath: '/products',
    pagePath: '(catalog)/(listing)/products/page.tsx',
    loadingPath: '(catalog)/loading.tsx',
    label: 'Loading product listing',
    renderStrategy: 'lazy-module',
  },
  {
    routePath: '/phones',
    pagePath: '(catalog)/(listing)/[category]/page.tsx',
    loadingPath: '(catalog)/loading.tsx',
    label: 'Loading product listing',
    renderStrategy: 'lazy-module',
  },
  {
    routePath: '/products/iphone-16-pro',
    pagePath: '(catalog)/(pdp)/products/[productSlug]/page.tsx',
    loadingPath: '(catalog)/(pdp)/products/[productSlug]/loading.tsx',
    label: 'Loading product page',
    renderStrategy: 'lazy-module',
  },
  {
    routePath: '/product/iphone-16-pro',
    pagePath: '(catalog)/(pdp)/product/[productSlug]/page.tsx',
    loadingPath: '(catalog)/(pdp)/product/[productSlug]/loading.tsx',
    label: 'Loading product page',
    renderStrategy: 'lazy-module',
  },
  {
    routePath: '/phones/iphone-16-pro',
    pagePath: '(catalog)/(pdp)/[category]/[productSlug]/page.tsx',
    loadingPath: '(catalog)/(pdp)/[category]/[productSlug]/loading.tsx',
    label: 'Loading product page',
    renderStrategy: 'lazy-module',
  },
  {
    routePath: '/checkout',
    pagePath: '(commerce)/checkout/page.tsx',
    loadingPath: '(commerce)/loading.tsx',
    label: 'Loading commerce page',
    renderStrategy: 'lazy-module',
  },
  {
    routePath: '/account',
    pagePath: '(customer)/account/page.tsx',
    loadingPath: '(customer)/loading.tsx',
    label: 'Loading customer page',
    renderStrategy: 'lazy-module',
  },
  {
    routePath: '/receipts',
    pagePath: '(customer)/receipts/page.tsx',
    loadingPath: '(customer)/loading.tsx',
    label: 'Loading customer page',
    renderStrategy: 'lazy-module',
  },
  {
    routePath: '/reviews',
    pagePath: '(utility)/reviews/page.tsx',
    loadingPath: '(utility)/reviews/loading.tsx',
    label: 'Loading utility page',
    renderStrategy: 'lazy-module',
  },
] as const;

describe('storefront route groups', () => {
  it('exposes the runtime route entrypoints and loading boundaries for Tasks 3-5', () => {
    for (const routePath of runtimeRouteManifest) {
      expect(existsSync(resolve(slugDirectory, routePath))).toBe(true);
    }
  });

  it('removes the legacy root locations for the Task 5 route families', () => {
    for (const routePath of legacyRouteManifest) {
      expect(existsSync(resolve(slugDirectory, routePath))).toBe(false);
    }
  });

  it('removes the retired shared storefront layout fallback', () => {
    expect(
      existsSync(resolve(slugDirectory, 'storefront-layout-fallback.tsx'))
    ).toBe(false);
    expect(
      existsSync(resolve(slugDirectory, 'storefront-layout-fallback.test.tsx'))
    ).toBe(false);
  });

  it('keeps utility LCP routes outside a route-family loading boundary', () => {
    // A group-level (utility)/loading.tsx becomes the visible PPR fallback for
    // /repair, /imei-check, and /repairs, hiding their leaf LCP copy until $RC.
    // Leaf loading.tsx files own first paint, matching /compare.
    expect(existsSync(resolve(slugDirectory, '(utility)/loading.tsx'))).toBe(
      false
    );
  });

  it('keeps root blog listing outside a route-family loading boundary', () => {
    // The root blog listing owns crawlable article anchors in raw HTML for
    // monitored SEO checks. Non-static merchants use an inline page Suspense
    // boundary instead of a broad route-group loading.tsx shell.
    expect(existsSync(resolve(slugDirectory, '(blog)/loading.tsx'))).toBe(
      false
    );
  });

  it('keeps PDP routes out of the full catalog CSS group', () => {
    expect(existsSync(resolve(slugDirectory, '(catalog)/layout.tsx'))).toBe(
      false
    );
    expect(
      existsSync(resolve(slugDirectory, '(catalog)/(pdp)/layout.tsx'))
    ).toBe(true);
    expect(
      existsSync(resolve(slugDirectory, '(catalog)/(listing)/layout.tsx'))
    ).toBe(true);
    expect(
      existsSync(
        resolve(
          slugDirectory,
          '(catalog)/(pdp)/[category]/[productSlug]/page.tsx'
        )
      )
    ).toBe(true);
    expect(
      existsSync(
        resolve(
          slugDirectory,
          '(catalog)/(listing)/[category]/[productSlug]/page.tsx'
        )
      )
    ).toBe(false);
  });

  it.each(
    firstPaintOwnershipManifest
  )('assigns first paint to the route-family loading boundary for $routePath', async (route) => {
    await expectNearestLoadingBoundaryOwnsFirstPaint({
      importMetaUrl: import.meta.url,
      routePath: route.routePath,
      pageRelativePath: route.pagePath,
      loadingRelativePath: route.loadingPath,
      label: route.label,
      renderStrategy: route.renderStrategy,
      ...('searchParams' in route ? { searchParams: route.searchParams } : {}),
    });
  }, 30_000);
});
