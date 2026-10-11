import { describe, expect, it } from 'vitest';
import { eventPipelineGatewayCronAdminPaths } from './event-pipeline-gateway-cron-admin-paths';

describe('gateway reconciliation admin paths', () => {
  it('pins the admin-client chains to the cron and wedge sweep', () => {
    expect(eventPipelineGatewayCronAdminPaths).toHaveLength(3);
    for (const path of eventPipelineGatewayCronAdminPaths) {
      expect(path.slice(0, 3)).toEqual([
        'apps/web/src/app/api/cron/reconcile-gateway-paid-orders/route.ts',
        'apps/web/src/lib/payments/reconcile-wedged-gateway-orders.ts',
        'apps/web/src/lib/payments/finalize-order-gateway-payment.ts',
      ]);
      expect(path.at(-1)).toBe('apps/web/src/lib/supabase/admin.ts');
    }
  });
});
