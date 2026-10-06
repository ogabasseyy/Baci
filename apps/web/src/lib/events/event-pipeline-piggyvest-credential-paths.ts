// Reviewed PiggyVest/savings credential import chains.
//
// Direct env.ts edges read only the server-only HMAC getters
// (getPiggyvestWebhookSecret/getPiggyvestApiConfig): the webhook route
// verifies provider signatures and the plan route calls the provider API.
// The VTU chains are transitive: savings flows resolve VTU customers via
// vtu-pending-transaction, which pulls the Kuda client whose debug logger
// reads only the getKudaBillDebug boolean flag. No route in these chains
// touches a service-role credential.
const envPath = 'apps/web/src/env.ts';
const savingsShared =
  'apps/web/src/app/api/storefront/customer/savings/shared.ts';
const vtuPendingTransaction = 'apps/web/src/lib/vtu-pending-transaction.ts';
const kuda = 'apps/web/src/lib/kuda.ts';
const kudaDebugLog = 'apps/web/src/lib/kuda-debug-log.ts';

const vtuCredentialSuffix = [
  vtuPendingTransaction,
  kuda,
  kudaDebugLog,
  envPath,
] as const;

export const eventPipelinePiggyvestCredentialPaths = [
  [
    'apps/web/src/app/api/storefront/customer/savings/funding/route.ts',
    savingsShared,
    ...vtuCredentialSuffix,
  ],
  [
    'apps/web/src/app/api/storefront/customer/savings/notifications/route.ts',
    savingsShared,
    ...vtuCredentialSuffix,
  ],
  [
    'apps/web/src/app/api/storefront/customer/wallet/piggyvest-plan/route.ts',
    envPath,
  ],
  [
    'apps/web/src/app/api/storefront/customer/wallet/piggyvest-plan/route.ts',
    ...vtuCredentialSuffix,
  ],
  ['apps/web/src/app/api/webhooks/piggyvest/route.ts', envPath],
] as const;
