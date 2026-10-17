// Admin-client chains through the wallet-only VTU replay helper.
// vtu-replay-fulfillment.ts is the wallet-only route's own replay tail
// (Muse R128 extraction, PR #3655): server-only, covered by the
// temporary VTU wallet-only checkout exception (AGENTS.md), and it
// reaches the admin factory only through fulfillPendingVtuTransaction
// — the same fulfillment the route itself performs. Both chains end
// at the notification senders (email/SMS token delivery), never at a
// client-reachable read.
const replay = 'apps/web/src/lib/vtu-replay-fulfillment.ts';
const fulfill = 'apps/web/src/lib/vtu-fulfillment.ts';
const zepto = 'apps/web/src/lib/zeptomail.ts';
const sending = 'apps/web/src/lib/merchant-sending-domain.ts';
const admin = 'apps/web/src/lib/supabase/admin.ts';

export const eventPipelineVtuReplayAdminPaths = [
  [replay, fulfill, zepto, sending, admin],
  [replay, fulfill, zepto, admin],
];
