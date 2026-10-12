import { describe, expect, it } from 'vitest';
import { serviceAuthorityGraphFindings } from './event-pipeline-service-authority-graph';

const route =
  'apps/web/src/app/api/cron/reconcile-gateway-paid-orders/route.ts';
const sibling = 'apps/web/src/app/api/cron/other-reconcile/route.ts';
const sweep = 'apps/web/src/lib/payments/reconcile-wedged-gateway-orders.ts';
const finalizer = 'apps/web/src/lib/payments/finalize-order-gateway-payment.ts';
const inventory = 'apps/web/src/lib/payments/confirm-paid-order-inventory.ts';
const review =
  'apps/web/src/lib/payments/file-inventory-confirmation-review.ts';
const admin = 'apps/web/src/lib/supabase/admin.ts';

function sourceGraph(root: string) {
  return new Map([
    [root, "import '@/lib/payments/reconcile-wedged-gateway-orders';"],
    [sweep, "import '@/lib/payments/finalize-order-gateway-payment';"],
    [finalizer, "import '@/lib/payments/confirm-paid-order-inventory';"],
    [inventory, "import '@/lib/payments/file-inventory-confirmation-review';"],
    [review, "import '@/lib/supabase/admin';"],
    [admin, 'export const createAdminClient = () => null;'],
  ]);
}

describe('gateway cron admin authority', () => {
  it('allows the existing exact reconciliation path', () => {
    expect(
      serviceAuthorityGraphFindings(sourceGraph(route), [route]).filter(
        (finding) =>
          finding.includes('API import graph reaches admin authority')
      )
    ).toEqual([]);
  });

  it('rejects a sibling cron taking the same admin path', () => {
    expect(
      serviceAuthorityGraphFindings(sourceGraph(sibling), [sibling]).join('\n')
    ).toContain(`${sibling}: API import graph reaches admin authority`);
  });
});
