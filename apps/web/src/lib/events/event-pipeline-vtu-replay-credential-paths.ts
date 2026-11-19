// Credential (env.ts) chains through the wallet-only VTU replay
// helper. Same trust basis as the admin-paths registration (PR
// #3655, AGENTS.md checkout exception): the replay tail reads
// provider/credential configuration only through the fulfillment it
// shares with the wallet-only route — never exfiltrating to the
// client (responses carry the fixed success payload only).
// Join-prefixed mirrors (PR #3741, Phase 2): the claim-join invokes
// the same replay tail server-side, so the same four chains re-root
// at the join module with no new authority.
const join = 'apps/web/src/lib/vtu-claim-join.ts';
const replay = 'apps/web/src/lib/vtu-replay-fulfillment.ts';
const fulfill = 'apps/web/src/lib/vtu-fulfillment.ts';
const zepto = 'apps/web/src/lib/zeptomail.ts';
const push = 'apps/web/src/lib/expo-push.ts';
const admin = 'apps/web/src/lib/supabase/admin.ts';
const env = 'apps/web/src/env.ts';

export const eventPipelineVtuReplayCredentialPaths = [
  [replay, fulfill, env],
  [replay, fulfill, push, env],
  [replay, fulfill, push, admin, env],
  [replay, fulfill, zepto, env],
  [join, replay, fulfill, env],
  [join, replay, fulfill, push, env],
  [join, replay, fulfill, push, admin, env],
  [join, replay, fulfill, zepto, env],
];
