import { describe, expect, it } from 'vitest';
import { eventPipelineShippingCredentialPaths } from './event-pipeline-shipping-credential-paths';

describe('eventPipelineShippingCredentialPaths', () => {
  it('allows only the audited shipping quote proof credential paths', () => {
    expect(eventPipelineShippingCredentialPaths).toHaveLength(24);
    expect(eventPipelineShippingCredentialPaths).toContainEqual([
      'apps/web/src/lib/shipping/shipping-quote-route-proof.ts',
      'apps/web/src/env.ts',
    ]);
  });

  describe('bugfix: admin GIG quote route path went stale after #3876', () => {
    const giglQuoteRoute =
      'apps/web/src/app/api/orders/[id]/shipping/gigl-quote/route.ts';

    it('allows the direct admin-order quote handler chain', () => {
      expect(eventPipelineShippingCredentialPaths).toContainEqual([
        giglQuoteRoute,
        'apps/web/src/app/api/shipping/quotes/admin-order-gigl-quote.ts',
        'apps/web/src/lib/shipping/persist-admin-gigl-quote.ts',
        'apps/web/src/lib/shipping/shipping-quote-route-proof.ts',
        'apps/web/src/env.ts',
      ]);
    });

    it('no longer lets the route reach credentials through the public quotes route', () => {
      const paths: readonly (readonly string[])[] =
        eventPipelineShippingCredentialPaths;
      const viaQuotesRoute = paths.filter(
        (path) =>
          path[0] === giglQuoteRoute &&
          path.includes('apps/web/src/app/api/shipping/quotes/route.ts')
      );
      expect(viaQuotesRoute).toEqual([]);
    });
  });
});
