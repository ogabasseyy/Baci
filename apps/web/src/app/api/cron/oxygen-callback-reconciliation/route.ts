import { hasValidCronSecret } from '@/lib/cron-secret-auth';
import { connectOxygenRuntime } from '@/lib/payments/oxygen/runtime-connection';
import { reconcileOxygenCallbacks } from '@/lib/payments/oxygen/runtime-reconciliation';

export const maxDuration = 120;

// A separate scheduler must invoke this endpoint; no scheduler is registered here.
export async function GET(request: Request) {
  if (!hasValidCronSecret(request.headers, process.env.CRON_SECRET)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (process.env.OXYGEN_CALLBACK_DRAIN_ENABLED !== 'true') {
    return Response.json({ enabled: false });
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
    return Response.json({ enabled: true });
  } catch {
    return Response.json(
      { error: 'Callback drain unavailable' },
      { status: 503 }
    );
  }
}
