import { describe, expect, it } from 'vitest';
import { eventPipelineRedvaultCredentialPaths } from './event-pipeline-redvault-credential-paths';

describe('eventPipelineRedvaultCredentialPaths', () => {
  it('allows only the audited RedVault gateway credential paths', () => {
    expect(eventPipelineRedvaultCredentialPaths).toHaveLength(8);
    expect(eventPipelineRedvaultCredentialPaths).toContainEqual([
      'apps/web/src/app/api/cron/reconcile-gateway-paid-orders/route.ts',
      'apps/web/src/lib/payments/drain-failed-paid-order-side-effects.ts',
      'apps/web/src/lib/payments/finalize-order-gateway-payment.ts',
      'apps/web/src/lib/payments/resolve-order-gateway-completion.ts',
      'apps/web/src/lib/checkout/storefront-order-rpc-client.ts',
      'apps/web/src/lib/supabase/scoped-jwt.ts',
      'apps/web/src/lib/agentic/jwt-signing-material.ts',
      'apps/web/src/env.ts',
    ]);
  });
});
