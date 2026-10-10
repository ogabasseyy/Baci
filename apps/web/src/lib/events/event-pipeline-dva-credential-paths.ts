const env = 'apps/web/src/env.ts';
const persist = 'apps/web/src/lib/payments/persist-paystack-dva-assignment.ts';
const reserve = 'apps/web/src/lib/payments/reserve-paystack-dva-assignment.ts';
const generateRoute = 'apps/web/src/app/api/orders/[id]/generate-dva/route.ts';
const generateTestSupport =
  'apps/web/src/app/api/orders/[id]/generate-dva/generate-dva-test-support.ts';
const provisionCreditDva =
  'apps/web/src/app/api/orders/[id]/ship-on-credit/provision-credit-order-dva.ts';
const shipOnCreditRoute =
  'apps/web/src/app/api/orders/[id]/ship-on-credit/route.ts';
const ordersRoute = 'apps/web/src/app/api/orders/route.ts';
const initializeRoute = 'apps/web/src/app/api/payments/initialize/route.ts';

// Paystack DVA reservation reaches the credential-bearing environment module
// through the persist/reserve helpers from every provisioning entrypoint.
export const eventPipelineDvaCredentialPaths = [
  [persist, reserve, env],
  [reserve, env],
  [generateRoute, reserve, env],
  [generateTestSupport, generateRoute, reserve, env],
  [provisionCreditDva, persist, reserve, env],
  [shipOnCreditRoute, provisionCreditDva, persist, reserve, env],
  [ordersRoute, persist, reserve, env],
  [initializeRoute, persist, reserve, env],
];
