const envPath = 'apps/web/src/env.ts';
const admin = 'apps/web/src/lib/supabase/admin.ts';
const zeptomail = 'apps/web/src/lib/zeptomail.ts';
const sender = 'apps/web/src/lib/feedback/send-feedback-report-email.ts';
const route = 'apps/web/src/app/api/feedback/route.ts';

// Owner-approved 2026-10-30 (in-app feedback PR): the authenticated,
// merchant-resolved, rate-limited feedback route emails each report to the
// fixed Baci support inbox only through the audited feedback sender and the
// shared Zeptomail sender, whose delivery-attempt audit uses the admin client.
// The report itself is stored with the caller's own RLS session.
const zeptomailTail = [sender, zeptomail, envPath];
const zeptomailAdminTail = [sender, zeptomail, admin, envPath];

export const eventPipelineFeedbackCredentialPaths = [
  [route, ...zeptomailTail],
  [route, ...zeptomailAdminTail],
  [...zeptomailTail],
  [...zeptomailAdminTail],
] as const;
