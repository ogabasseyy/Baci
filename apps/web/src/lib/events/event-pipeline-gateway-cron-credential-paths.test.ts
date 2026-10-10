import { describe, expect, it } from 'vitest';
import { eventPipelineGatewayCronCredentialPaths } from './event-pipeline-gateway-cron-credential-paths';

describe('gateway reconciliation credential paths', () => {
  it('pins the existing finalizer chains to the cron and wedge sweep', () => {
    expect(eventPipelineGatewayCronCredentialPaths).toHaveLength(4);
    for (const path of eventPipelineGatewayCronCredentialPaths) {
      expect(path.slice(0, 3)).toEqual([
        'apps/web/src/app/api/cron/reconcile-gateway-paid-orders/route.ts',
        'apps/web/src/lib/payments/reconcile-wedged-gateway-orders.ts',
        'apps/web/src/lib/payments/finalize-order-gateway-payment.ts',
      ]);
    }
  });
});
