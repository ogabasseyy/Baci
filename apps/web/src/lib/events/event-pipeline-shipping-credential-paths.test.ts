import { describe, expect, it } from 'vitest';
import { eventPipelineShippingCredentialPaths } from './event-pipeline-shipping-credential-paths';

const partnerProofRoutes = [
  'apps/web/src/app/api/partners/v1/quotes/route.ts',
  'apps/web/src/app/api/partners/v1/orders/route.ts',
  'apps/web/src/app/api/partners/v1/orders/[orderId]/route.ts',
  'apps/web/src/app/api/partners/v1/order-submissions/route.ts',
  'apps/web/src/app/api/internal/partner-order-reconciliation/route.ts',
];

describe('eventPipelineShippingCredentialPaths', () => {
  it('allows only the audited shipping quote proof credential paths', () => {
    expect(eventPipelineShippingCredentialPaths).toHaveLength(38);
    expect(eventPipelineShippingCredentialPaths).toContainEqual([
      'apps/web/src/lib/shipping/shipping-quote-route-proof.ts',
      'apps/web/src/env.ts',
    ]);
    expect(eventPipelineShippingCredentialPaths).toContainEqual([
      'apps/web/src/app/api/orders/[id]/shipping/gigl-waybill/route.ts',
      'apps/web/src/lib/shipping/persist-external-gigl-waybill.ts',
      'apps/web/src/lib/shipping/shipping-quote-route-proof.ts',
      'apps/web/src/env.ts',
    ]);
  });

  it.each(partnerProofRoutes)('pins the exact proof path for %s', (route) => {
    expect(eventPipelineShippingCredentialPaths).toContainEqual([
      route,
      'apps/web/src/lib/shipping/shipping-quote-route-proof.ts',
      'apps/web/src/env.ts',
    ]);
  });

  it('pins the scoped order signer to the internal partner verifier route', () => {
    expect(eventPipelineShippingCredentialPaths).toContainEqual([
      'apps/web/src/app/api/internal/partner-order-reconciliation/route.ts',
      'apps/web/src/lib/checkout/storefront-order-rpc-client.ts',
      'apps/web/src/lib/supabase/scoped-jwt.ts',
      'apps/web/src/lib/agentic/jwt-signing-material.ts',
      'apps/web/src/env.ts',
    ]);
  });
});
