import { describe, expect, it } from 'vitest';
import { eventPipelineGatewayCronCredentialPaths } from './event-pipeline-gateway-cron-credential-paths';

describe('gateway reconciliation credential paths', () => {
  it('pins the existing finalizer chains to the cron and wedge sweep', () => {
    expect(eventPipelineGatewayCronCredentialPaths).toHaveLength(6);
    for (const path of eventPipelineGatewayCronCredentialPaths.slice(0, 4)) {
      expect(path.slice(0, 3)).toEqual([
        'apps/web/src/app/api/cron/reconcile-gateway-paid-orders/route.ts',
        'apps/web/src/lib/payments/reconcile-wedged-gateway-orders.ts',
        'apps/web/src/lib/payments/finalize-order-gateway-payment.ts',
      ]);
    }
    const recovery =
      'apps/web/src/app/api/cron/cleanup-checkout-shipping-recovery-previews/route.ts';
    expect(eventPipelineGatewayCronCredentialPaths.slice(4)).toEqual([
      [recovery, 'apps/web/src/env.ts'],
      [recovery, 'apps/web/src/lib/supabase/admin.ts', 'apps/web/src/env.ts'],
    ]);
  });
});
