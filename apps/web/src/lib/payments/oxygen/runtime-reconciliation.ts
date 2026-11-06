import 'server-only';
import { z } from 'zod';
import {
  oxygenProviderContextSchema,
  oxygenProviderStateSchema,
} from '@/schemas/oxygen-runtime';
import { type OxygenProvider, OxygenProviderFailure } from './provider';
import { oxygenDiagnostic } from './provider-diagnostic';
import {
  OXYGEN_CALLBACK_DURATION_MS,
  OXYGEN_CALLBACK_MIN_REMAINING_MS,
} from './reconciliation-budget';
import { recordOxygenFailure } from './record-failure';
import { executeOxygenAction, oxygenActionAllowed } from './runtime-executor';
import { trackOxygenExecution } from './runtime-failure';
import {
  type OxygenRuntimeRpc,
  oxygenRuntimeRpc,
  oxygenRuntimeSnapshotSchema,
} from './runtime-service';
import type { OxygenWebhookEvent } from './webhook';

async function callbackRpc(
  worker: OxygenRuntimeRpc,
  partner: string,
  operation: string,
  payload: unknown = {}
) {
  const result = await worker.rpc('oxygen_callback', {
    p_operation: operation,
    p_partner: partner,
    p_payload: payload,
  });
  if (result.error) throw new Error('Callback storage unavailable');
  return result.data;
}
export async function acceptOxygenCallback(
  worker: OxygenRuntimeRpc,
  partner: string,
  event: OxygenWebhookEvent
) {
  return z
    .object({
      result: z.enum(['accepted', 'duplicate']),
      wakeNeeded: z.boolean().optional(),
    })
    .parse(await callbackRpc(worker, partner, 'accept', event));
}
/** A callback is a hint to perform a scoped provider read. Neither monetary
 * callback fields nor redirects can confirm payment, activation or settlement. */
export async function reconcileOxygenCallbacks(
  worker: OxygenRuntimeRpc,
  provider: OxygenProvider,
  partner: string,
  hosts: ReadonlySet<string>,
  paymentCheck?: (
    workflow: string,
    callbackId: string,
    retryKey: string
  ) => Promise<void>,
  filter?: {
    kind: 'address' | 'selfie' | 'transaction';
    applicationReference?: string;
  },
  options?: { deadlineMs: number }
): Promise<void> {
  const deadlineMs =
    options?.deadlineMs ?? Date.now() + OXYGEN_CALLBACK_DURATION_MS;
  const jobs = z
    .array(
      z.object({
        id: z.uuid(),
        retryKey: z.uuid(),
        kind: z.enum(['address', 'selfie', 'transaction']),
        workflowIds: z.array(z.uuid()),
      })
    )
    .parse(await callbackRpc(worker, partner, 'pending', filter ?? {}));
  let reads = 0;
  for (const job of jobs) {
    if (job.workflowIds.length === 0) continue;
    // A callback must resolve to one workflow. The database quarantines
    // ambiguous addresses; leave unexpected ambiguity for the next scan.
    if (job.workflowIds.length > 1) {
      continue;
    }
    let complete = job.workflowIds.length > 0;
    for (const id of job.workflowIds) {
      // A staging payment check can make three provider calls, each with a
      // cold login and a 30-second timeout. Keep a minute for storage and
      // leave remaining callbacks queued when the invocation is nearly spent.
      if (
        reads >= 2 ||
        deadlineMs - Date.now() < OXYGEN_CALLBACK_MIN_REMAINING_MS
      )
        return;
      try {
        if (job.kind === 'transaction' && paymentCheck) {
          reads++;
          await paymentCheck(id, job.id, job.retryKey);
          continue;
        }
        const snapshot = oxygenRuntimeSnapshotSchema.parse(
          await oxygenRuntimeRpc(worker, 'worker_status', id)
        );
        // Address hints only advance pre-activation verification. Preserve the
        // event in the inbox but retire its current generation once the bound
        // workflow is already activated; replaying KYC cannot advance it.
        if (job.kind !== 'transaction' && snapshot.stage === 'activated')
          continue;
        const command =
          job.kind !== 'transaction'
            ? { action: 'refresh_kyc' as const }
            : { action: 'refresh_payment_setup' as const };
        if (
          !oxygenActionAllowed(
            {
              stage: snapshot.stage,
              environment: snapshot.environment,
              state: snapshot.state,
            },
            command
          )
        ) {
          // A blocked workflow is not a reconciled callback. Keep the durable
          // event eligible for bounded retry instead of silently retiring it.
          complete = false;
          continue;
        }
        const queued = z
          .object({ commandId: z.uuid(), status: z.string() })
          .parse(
            await oxygenRuntimeRpc(worker, 'reconcile', id, {
              version: snapshot.version,
              idempotencyKey: job.retryKey,
              command,
            })
          );
        if (queued.status === 'succeeded') {
          if (
            job.kind !== 'transaction' &&
            snapshot.state.kyc?.[
              job.kind === 'selfie' ? 'selfie_status' : 'address_status'
            ] !== 'DONE'
          )
            complete = false;
          continue;
        }
        reads++;
        const raw = await oxygenRuntimeRpc(worker, 'claim', queued.commandId, {
          commandId: queued.commandId,
        });
        if (raw === null) {
          complete = false;
          continue;
        }
        const startedAt = Date.now();
        const execution = trackOxygenExecution(
          provider.forCommand?.(worker, id, queued.commandId) ?? provider
        );
        let result: Awaited<ReturnType<typeof executeOxygenAction>>;
        try {
          const { context } = z
            .object({ context: oxygenProviderContextSchema })
            .parse(raw);
          if (context.workflowId !== id || context.partnerReference !== partner)
            throw new Error('Binding mismatch');
          result = await executeOxygenAction(
            context,
            command,
            execution.provider,
            hosts
          );
          result.state = oxygenProviderStateSchema.parse(result.state);
        } catch (failure) {
          const diagnostic =
            failure instanceof OxygenProviderFailure && failure.diagnostic
              ? failure.diagnostic
              : oxygenDiagnostic(
                  execution.operation(),
                  'validation',
                  'not_sent',
                  startedAt
                );
          await recordOxygenFailure(
            worker,
            queued.commandId,
            id,
            snapshot.stage,
            'failed',
            diagnostic
          );
          complete = false;
          continue;
        }
        await oxygenRuntimeRpc(worker, 'finish', queued.commandId, {
          commandId: queued.commandId,
          outcome: 'succeeded',
          ...result,
        });
        // A successful status lookup may still be PROCESSING. Keep the durable
        // hint eligible for bounded retry until Oxygen actually confirms it.
        if (
          job.kind !== 'transaction' &&
          result.state.kyc?.[
            job.kind === 'selfie' ? 'selfie_status' : 'address_status'
          ] !== 'DONE'
        )
          complete = false;
      } catch {
        complete = false;
      }
    }
    await callbackRpc(worker, partner, complete ? 'complete' : 'defer', {
      id: job.id,
      retryKey: job.retryKey,
    });
  }
}
