// Background VPS entrypoint only. These exact audited mail dependencies confer
// no authority on HTTP routes, server actions, browser roots or sibling workers.
const worker = 'apps/web/src/scripts/process-merchant-onboarding-emails.ts';
const zepto = 'apps/web/src/lib/zeptomail.ts';
const sender = 'apps/web/src/lib/merchant-sending-domain.ts';
const admin = 'apps/web/src/lib/supabase/admin.ts';
const env = 'apps/web/src/env.ts';

export const onboardingEmailWorkerAuthority = {
  worker,
  adminPaths: [
    [worker, zepto, admin],
    [worker, zepto, sender, admin],
  ],
  credentialPaths: [
    [worker, env],
    [worker, zepto, env],
    [worker, zepto, admin, env],
  ],
} as const;
