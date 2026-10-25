import 'server-only';
import { z } from 'zod';
import {
  type OxygenPaymentRecoveryRequest,
  oxygenPaymentRecoveryRequestSchema,
  oxygenPaymentRecoveryStateSchema,
} from '@/schemas/oxygen-payment-recovery';
import { type OxygenProvider, OxygenProviderFailure } from './provider';
import type { OxygenObservedResponse } from './response-evidence';
import { hosted } from './runtime-policy';
import type { OxygenRuntimeRpc } from './runtime-service';

async function rpc(
  client: OxygenRuntimeRpc,
  operation: string,
  workflow: string,
  payload: Record<string, unknown> = {}
) {
  const result = await client.rpc('oxygen_payment_recovery', {
    p_operation: operation,
    p_workflow_id: workflow,
    p_payload: payload,
  });
  if (result.error) throw new Error('Payment recovery unavailable');
  return result.data;
}
export async function readOxygenPaymentRecovery(
  user: OxygenRuntimeRpc,
  workflow: string,
  hosts: ReadonlySet<string>
) {
  const state = oxygenPaymentRecoveryStateSchema.parse(
    await rpc(user, 'status', workflow)
  );
  if (state.paymentUrl) state.paymentUrl = hosted(state.paymentUrl, hosts);
  if (state.setupUrl) state.setupUrl = hosted(state.setupUrl, hosts);
  return state;
}
/** A separate recovery ledger never clears/replays the original uncertain approval. */
export async function performOxygenPaymentRecovery(
  user: OxygenRuntimeRpc,
  workerClient: () => Promise<OxygenRuntimeRpc>,
  providerFactory: (
    observe: (response: OxygenObservedResponse) => Promise<void>
  ) => OxygenProvider,
  hosts: ReadonlySet<string>,
  input: OxygenPaymentRecoveryRequest,
  observeFactory: (
    worker: OxygenRuntimeRpc,
    workflow: string,
    command: string
  ) => (response: OxygenObservedResponse) => Promise<void>
) {
  const request = oxygenPaymentRecoveryRequestSchema.parse(input);
  const queued = z
    .object({ commandId: z.uuid(), status: z.string() })
    .parse(await rpc(user, 'enqueue', request.workflowId, request));
  if (queued.status !== 'queued')
    return readOxygenPaymentRecovery(user, request.workflowId, hosts);
  let worker: OxygenRuntimeRpc;
  try {
    worker = await workerClient();
  } catch {
    await rpc(user, 'abandon', request.workflowId, {
      commandId: queued.commandId,
    });
    throw new Error('Payment recovery unavailable');
  }
  const claimed = await rpc(worker, 'claim', request.workflowId, {
    commandId: queued.commandId,
  });
  if (claimed === null)
    return readOxygenPaymentRecovery(user, request.workflowId, hosts);
  let sent = false;
  try {
    const context = z
      .object({
        reference: z.uuid(),
        action: oxygenPaymentRecoveryRequestSchema.shape.action,
      })
      .parse(claimed);
    if (
      context.reference !== request.reference ||
      context.action !== request.action
    )
      throw new Error('Recovery binding mismatch');
    const observe = observeFactory(
      worker,
      request.workflowId,
      queued.commandId
    );
    const provider = providerFactory(observe);
    const operation =
      request.action === 'check_status'
        ? 'payment'
        : request.action === 'resend_upfront'
          ? 'upfront_link'
          : 'repayment_link';
    sent = true;
    const raw = await provider.call(operation, {
      loan_reference: context.reference,
    });
    let result: Record<string, unknown>;
    if (request.action === 'check_status') {
      const checked = z
        .object({
          split_payment: z.object({ completed: z.boolean() }),
          repayment_setup: z.object({ completed: z.boolean() }),
        })
        .parse(raw);
      result = {
        paymentComplete: checked.split_payment.completed,
        setupComplete: checked.repayment_setup.completed,
      };
    } else {
      const link = hosted(
        z.object({ url: z.string().max(20000) }).parse(raw).url,
        hosts
      );
      result =
        request.action === 'resend_upfront'
          ? { paymentUrl: link }
          : { setupUrl: link };
    }
    await rpc(worker, 'finish', request.workflowId, {
      commandId: queued.commandId,
      outcome: 'succeeded',
      result,
    });
  } catch (error) {
    const outcome =
      request.action === 'check_status' ||
      !sent ||
      (error instanceof OxygenProviderFailure &&
        error.outcome !== 'indeterminate')
        ? 'failed'
        : 'indeterminate';
    await rpc(worker, 'finish', request.workflowId, {
      commandId: queued.commandId,
      outcome,
      result: {},
      diagnostic:
        error instanceof OxygenProviderFailure
          ? (error.diagnostic ?? null)
          : null,
    });
    throw new Error(
      'Payment recovery could not be confirmed. Check for an update before retrying.'
    );
  }
  return readOxygenPaymentRecovery(user, request.workflowId, hosts);
}
