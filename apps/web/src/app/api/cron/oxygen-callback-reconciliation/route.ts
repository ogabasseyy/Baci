import { hasValidCronSecret } from '@/lib/cron-secret-auth';
import { readOxygenCallbackBacklog } from '@/lib/payments/oxygen/runtime-callback-backlog';
import { connectOxygenRuntime } from '@/lib/payments/oxygen/runtime-connection';
import { reconcileOxygenCallbacks } from '@/lib/payments/oxygen/runtime-reconciliation';

export const maxDuration = 120;
const headers = { 'Cache-Control': 'no-store' };

// The VPS schedule invokes this endpoint; the drain remains disabled by default.
export async function GET(request: Request) {
  if (!hasValidCronSecret(request.headers, process.env.CRON_SECRET)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers });
  }
  if (process.env.OXYGEN_CALLBACK_DRAIN_ENABLED !== 'true') {
    return Response.json({ enabled: false }, { headers });
  }

  try {
    const connection = connectOxygenRuntime();
    if (!connection) throw new Error('Runtime unavailable');
    const worker = await connection.worker();
    await reconcileOxygenCallbacks(
      worker,
      connection.provider,
      connection.partnerReference,
      connection.hosts,
      async (workflow, callbackId, retryKey) => {
        await connection.reconcilePaymentCallback(
          worker,
          workflow,
          callbackId,
          retryKey
        );
      }
    );
    const backlog = await readOxygenCallbackBacklog(
      worker,
      connection.partnerReference
    );
    return Response.json({ enabled: true, backlog }, { headers });
  } catch {
    return Response.json(
      { error: 'Callback drain unavailable' },
      { status: 503, headers }
    );
  }
}
