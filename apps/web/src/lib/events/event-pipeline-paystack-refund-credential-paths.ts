// Owner-approved, expiring merchant refund push edge. See
// docs/agent-guidance/service-role-exceptions.md.
const route = 'apps/web/src/app/api/cron/process-settlements/route.ts';
const push = 'apps/web/src/lib/expo-push.ts';
const admin = 'apps/web/src/lib/supabase/admin.ts';
const env = 'apps/web/src/env.ts';

export const eventPipelinePaystackRefundCredentialPaths = [
  [route, push, env],
  [route, push, admin, env],
];
