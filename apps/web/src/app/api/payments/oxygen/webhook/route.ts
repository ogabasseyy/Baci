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
// after() shares this deadline; Next.js requires a literal route config.
export const maxDuration = 300;
export async function POST(request: Request) {
  const deadlineMs = Date.now() + maxDuration * 1000;
  const configuration = oxygenRuntimeCallbackConfiguration();
  const connection = connectOxygenRuntime();
  if (!configuration || !connection)
    return Response.json({ error: 'Callback unavailable' }, { status: 503 });
  // Header authentication and body validation run before worker login.
  return await receiveOxygenWebhook(request, configuration, async (event) => {
    const worker = await connection.worker();
    const acceptance = await acceptOxygenCallback(
      worker,
      connection.partnerReference,
      event
    );
    if (
      !(acceptance.result === 'duplicate' && acceptance.wakeNeeded === false) &&
      event.kind !== 'settlement' &&
      !(event.kind === 'address' && !event.applicationReference)
    )
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
              ),
            event.kind === 'address' || event.kind === 'selfie'
              ? {
                  kind: event.kind,
                  applicationReference: event.applicationReference,
                }
              : { kind: 'transaction' },
            { deadlineMs }
          );
        } catch {
          /* Durable queued inbox remains available for replay. */
        }
      });
    return acceptance.result;
  });
}
