// Exact chains for the paid-order amendment email drain. The cron route runs
// behind CRON_SECRET; the drain sends mail through the existing mail helper.
const route = 'apps/web/src/app/api/cron/process-settlements/route.ts';
const update = 'apps/web/src/lib/orders/paid-order-amendment-update.ts';
const zepto = 'apps/web/src/lib/zeptomail.ts';
const sending = 'apps/web/src/lib/merchant-sending-domain.ts';
const admin = 'apps/web/src/lib/supabase/admin.ts';
const env = 'apps/web/src/env.ts';

export const eventPipelinePaidOrderAmendmentAdminPaths = [
  [update, zepto, sending, admin],
  [update, zepto, admin],
];

export const eventPipelinePaidOrderAmendmentCredentialPaths = [
  [route, update, env],
  [update, env],
  [update, zepto, env],
  [update, zepto, admin, env],
];
