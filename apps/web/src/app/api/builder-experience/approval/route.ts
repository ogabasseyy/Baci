import type { NextRequest } from 'next/server';
import { checkCsrfProtection } from '@/lib/csrf';
import { createOwnerApprovalHandler } from '@/lib/experience/owner-approval-handler';
import { getConfiguredOwnerApproval } from '@/lib/experience/owner-approval-web-config';
import { getExperienceOwnerRuntime } from '@/lib/experience/owner-runtime';
import { createClient } from '@/lib/supabase/server';

async function handle(request: NextRequest) {
  const client = await createClient();
  const user = await client.auth.getUser();
  const headers = {
    'Cache-Control': 'private, no-store',
    'Referrer-Policy': 'no-referrer',
  };
  if (user.error || !user.data.user)
    return Response.json(
      { error: 'Sign in to review.' },
      { status: 401, headers }
    );
  const runtime =
    getExperienceOwnerRuntime()?.approval ?? getConfiguredOwnerApproval();
  if (!runtime)
    return Response.json(
      { error: 'Owner approval is not installed.' },
      { status: 503, headers }
    );
  return createOwnerApprovalHandler({
    ownerClient: async () => client,
    checkMutation: async () => {
      const csrf = await checkCsrfProtection(request);
      return csrf.valid ? null : new Response(null, { status: 403 });
    },
    load: runtime.load,
    confirm: runtime.confirm,
    loadLifecycle: runtime.loadLifecycle,
    confirmPublication: runtime.confirmPublication,
    confirmModeExit: runtime.confirmModeExit,
  })(request);
}
export const GET = handle;
export const POST = handle;
