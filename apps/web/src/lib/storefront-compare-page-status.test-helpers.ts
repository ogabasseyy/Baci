import type { storefrontComparePageStatus } from './storefront-compare-page-status';

export const storefrontComparePageStatusTestHelpers = {
  jsonResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  },

  buildOptions(
    fetchImpl: typeof fetch,
    overrides: Partial<
      Parameters<typeof storefrontComparePageStatus.resolve>[0]
    > = {}
  ) {
    return {
      origin: 'http://localhost:3000',
      identifier: 'ogabassey',
      categorySlug: 'laptops',
      comparisonSlug: 'left-laptop-vs-right-laptop',
      secret: 'test-internal-secret',
      fetchImpl,
      ...overrides,
    };
  },
};
