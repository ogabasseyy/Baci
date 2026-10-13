// Admin-client chains through the gateway reconciliation cron.
const route =
  'apps/web/src/app/api/cron/reconcile-gateway-paid-orders/route.ts';
const sweep = 'apps/web/src/lib/payments/reconcile-wedged-gateway-orders.ts';
const finalizer = 'apps/web/src/lib/payments/finalize-order-gateway-payment.ts';
const inventory = 'apps/web/src/lib/payments/confirm-paid-order-inventory.ts';
const review =
  'apps/web/src/lib/payments/file-inventory-confirmation-review.ts';
const effects = 'apps/web/src/lib/payments/run-paid-order-side-effects.ts';
const email = 'apps/web/src/lib/payments/paid-order-email-executor.ts';
const zepto = 'apps/web/src/lib/zeptomail.ts';
const sending = 'apps/web/src/lib/merchant-sending-domain.ts';
const admin = 'apps/web/src/lib/supabase/admin.ts';

export const eventPipelineGatewayCronAdminPaths = [
  [route, sweep, finalizer, inventory, review, admin],
  [route, sweep, finalizer, effects, email, zepto, sending, admin],
  [route, sweep, finalizer, effects, email, zepto, admin],
];
