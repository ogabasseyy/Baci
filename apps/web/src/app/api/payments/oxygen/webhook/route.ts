import { after } from 'next/server';
import {
  connectOxygenRuntime,
  oxygenRuntimeCallbackConfiguration,
} from '@/lib/payments/oxygen/runtime-connection';
import {
  acceptOxygenCallback,
  reconcileOxygenCallbacks,
} from '@/lib/payments/oxygen/runtime-reconciliation';
import { receiveOxygenWebhook } from '@/lib/payments/oxygen/webhook-receiver';
export const maxDuration = 120;
export async function POST(request: Request) {
  const configuration = oxygenRuntimeCallbackConfiguration();
  const connection = connectOxygenRuntime();
  if (!configuration || !connection)
    return Response.json({ error: 'Callback unavailable' }, { status: 503 });
  // Header authentication and body validation run before worker login.
  return await receiveOxygenWebhook(request, configuration, async (event) => {
    const worker = await connection.worker();
    const result = await acceptOxygenCallback(
      worker,
      connection.partnerReference,
      event
    );
    after(async () => {
      try {
        await reconcileOxygenCallbacks(
          worker,
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
      } catch {
        /* Durable queued inbox remains available for replay. */
      }
    });
    return result;
  });
}
