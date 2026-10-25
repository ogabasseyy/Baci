import { type NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { ensureActionRateLimit } from '@/lib/ensure-action-rate-limit';
import { connectOxygenRuntime } from '@/lib/payments/oxygen/runtime-connection';
import { reconcileOxygenCallbacks } from '@/lib/payments/oxygen/runtime-reconciliation';
export const maxDuration = 120;
/** Recovery entrypoint: normal worker Auth bearer, scoped again by database RPC. */
export async function POST(request: NextRequest) {
  if (
    !(await ensureActionRateLimit('oxygen-reconcile', {
      requests: 10,
      windowMs: 60_000,
    }))
  )
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  const csrf = await checkCsrfProtection(request);
  if (!csrf.valid)
    return (
      csrf.response ??
      NextResponse.json({ error: 'Invalid request' }, { status: 403 })
    );
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.supabase || !auth.user)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const connection = connectOxygenRuntime();
  if (!connection)
    return NextResponse.json(
      { error: 'Reconciliation unavailable' },
      { status: 503 }
    );
  const worker = auth.supabase;
  try {
    await reconcileOxygenCallbacks(
      auth.supabase,
      connection.provider,
      connection.partnerReference,
      connection.hosts,
      (workflow, callbackId, retryKey) =>
        connection.reconcilePaymentCallback(
          worker,
          workflow,
          callbackId,
          retryKey
        )
    );
    return NextResponse.json(
      { processed: true, activationEnabled: false, settlementEnabled: false },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch {
    return NextResponse.json(
      { error: 'Reconciliation unavailable' },
      { status: 403 }
    );
  }
}
