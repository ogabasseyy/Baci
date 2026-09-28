// Existing finalizer chains through the gateway reconciliation cron.
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
const notify = 'apps/web/src/lib/payments/notify-paid-order.ts';
const expo = 'apps/web/src/lib/expo-push.ts';
const completion =
  'apps/web/src/lib/payments/resolve-order-gateway-completion.ts';
const storefront = 'apps/web/src/lib/checkout/storefront-order-rpc-client.ts';
const jwt = 'apps/web/src/lib/supabase/scoped-jwt.ts';
const signing = 'apps/web/src/lib/agentic/jwt-signing-material.ts';
const admin = 'apps/web/src/lib/supabase/admin.ts';
const env = 'apps/web/src/env.ts';

export const eventPipelineGatewayCronCredentialPaths = [
  [route, sweep, finalizer, notify, expo, env],
  [route, sweep, finalizer, completion, storefront, jwt, signing, env],
  [route, sweep, finalizer, effects, email, env],
  [route, sweep, finalizer, effects, email, zepto, env],
];

export const eventPipelineGatewayCronAdminPaths = [
  [route, sweep, finalizer, inventory, review, admin],
  [route, sweep, finalizer, effects, email, zepto, sending, admin],
  [route, sweep, finalizer, effects, email, zepto, admin],
];
