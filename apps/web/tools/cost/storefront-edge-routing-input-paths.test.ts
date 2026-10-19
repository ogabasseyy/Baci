import { describe, expect, it } from 'vitest';
import { STOREFRONT_EDGE_ROUTING_INPUT_PATHS } from './storefront-edge-routing-input-paths';

describe('storefront edge routing input paths', () => {
  it('keeps the reviewed proxy and analytics authority paths explicit', () => {
    expect(STOREFRONT_EDGE_ROUTING_INPUT_PATHS).toEqual([
      'apps/web/next.config.ts',
      'apps/web/src/proxy.ts',
      'apps/web/src/components/analytics/google-store-widget.tsx',
      'apps/web/src/components/analytics/google-customer-reviews.tsx',
      'apps/web/src/components/storefront/ogabassey/components/negotiation-evidence.ts',
    ]);
  });
});
