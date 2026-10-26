const envPath = 'apps/web/src/env.ts';
const worker =
  'apps/web/src/app/api/cron/order-notifications/order-notification-outbox-worker.ts';
const workerRoute = 'apps/web/src/app/api/cron/order-notifications/route.ts';
const sender = 'apps/web/src/lib/send-manual-order-document.ts';
const claimLinks =
  'apps/web/src/lib/import-notifications/receipt-claim-links.ts';
const zeptomail = 'apps/web/src/lib/zeptomail.ts';
const admin = 'apps/web/src/lib/supabase/admin.ts';
const loginEmailRoute =
  'apps/web/src/app/api/storefront/receipts/claims/[token]/login-email/route.ts';
const loginHintClient = 'apps/web/src/lib/receipts/server-login-hint-client.ts';
const serviceClient = 'apps/web/src/lib/supabase/service.ts';

// The CRON-authenticated manual-order document sender builds receipt-claim
// links and dispatches Zeptomail delivery from the order-notification outbox
// worker. Both reach the credential-bearing environment module through these
// exact import paths.
const claimLinksTail = [sender, claimLinks, envPath];
const zeptomailTail = [sender, zeptomail, envPath];
const zeptomailAdminTail = [sender, zeptomail, admin, envPath];

export const eventPipelineManualOrderDocumentCredentialPaths = [
  [worker, ...claimLinksTail],
  [worker, ...zeptomailTail],
  [worker, ...zeptomailAdminTail],
  [workerRoute, worker, ...claimLinksTail],
  [workerRoute, worker, ...zeptomailTail],
  [workerRoute, worker, ...zeptomailAdminTail],
  [...claimLinksTail],
  [...zeptomailTail],
  [...zeptomailAdminTail],
  // The token-scoped login-email route resolves the recipient address
  // through the branded single-RPC login-hint boundary (PR 3580): the
  // route imports only the boundary helper, which is the sole importer of
  // the receipt-login-hint service brand. The 256-bit claim Bearer [REDACTED] is the
  // only credential on this path, and no table access flows through it.
  [loginEmailRoute, loginHintClient, serviceClient, envPath],
] as const;
