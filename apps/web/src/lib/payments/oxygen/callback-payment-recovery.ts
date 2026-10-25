import 'server-only';
import { z } from 'zod';
import { type OxygenProvider, OxygenProviderFailure } from './provider';
import type { OxygenRuntimeRpc } from './runtime-service';

/** Only a durable, worker-bound transaction callback can enqueue this read.
 * Approval history stays unchanged; no resend/approval operation is available. */
export async function reconcileOxygenCallbackPayment(
  worker: OxygenRuntimeRpc,
  providerFor: (command: string) => OxygenProvider,
  workflow: string,
  callbackId: string,
  retryKey: string
): Promise<void> {
  const queuedResponse = await worker.rpc('oxygen_callback_payment', {
    p_workflow_id: workflow,
    p_callback_id: callbackId,
    p_retry_key: retryKey,
  });
  if (queuedResponse.error) throw new Error('Callback payment unavailable');
  const queued = z
    .object({ commandId: z.uuid(), reference: z.uuid(), status: z.string() })
    .parse(queuedResponse.data);
  if (queued.status === 'succeeded') return;
  if (queued.status !== 'queued') throw new Error('Callback payment pending');
  async function rpc(operation: string, payload: Record<string, unknown>) {
    const response = await worker.rpc('oxygen_payment_recovery', {
      p_operation: operation,
      p_workflow_id: workflow,
      p_payload: { commandId: queued.commandId, ...payload },
    });
    if (response.error) throw new Error('Callback payment unavailable');
    return response.data;
  }
  const claimed = await rpc('claim', {});
  if (claimed === null) throw new Error('Callback payment pending');
  try {
    const context = z
      .object({ reference: z.uuid(), action: z.literal('check_status') })
      .parse(claimed);
    if (context.reference !== queued.reference)
      throw new Error('Reference changed');
    const raw = await providerFor(queued.commandId).call('payment', {
      loan_reference: context.reference,
    });
    const status = z
      .object({
        split_payment: z.object({ completed: z.boolean() }),
        repayment_setup: z.object({ completed: z.boolean() }),
      })
      .parse(raw);
    await rpc('finish', {
      outcome: 'succeeded',
      result: {
        paymentComplete: status.split_payment.completed,
        setupComplete: status.repayment_setup.completed,
      },
    });
  } catch (error) {
    await rpc('finish', {
      outcome: 'failed',
      result: {},
      diagnostic:
        error instanceof OxygenProviderFailure
          ? (error.diagnostic ?? null)
          : null,
    });
    throw new Error('Callback payment unconfirmed');
  }
}
