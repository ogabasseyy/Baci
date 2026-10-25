import 'server-only';
import { z } from 'zod';
import {
  oxygenProviderContextSchema,
  oxygenProviderStateSchema,
} from '@/schemas/oxygen-runtime';
import { type OxygenProvider, OxygenProviderFailure } from './provider';
import { oxygenDiagnostic } from './provider-diagnostic';
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
    .object({ result: z.enum(['accepted', 'duplicate']) })
    .parse(await callbackRpc(worker, partner, 'accept', event)).result;
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
  ) => Promise<void>
): Promise<void> {
  const jobs = z
    .array(
      z.object({
        id: z.uuid(),
        retryKey: z.uuid().optional(),
        kind: z.enum(['address', 'transaction']),
        workflowIds: z.array(z.uuid()),
      })
    )
    .parse(await callbackRpc(worker, partner, 'pending'));
  let reads = 0;
  for (const job of jobs) {
    if (job.workflowIds.length === 0) continue;
    let complete = job.workflowIds.length > 0;
    for (const id of job.workflowIds) {
      if (reads >= 2) return;
      try {
        if (job.kind === 'transaction' && paymentCheck) {
          reads++;
          await paymentCheck(id, job.id, job.retryKey ?? job.id);
          continue;
        }
        const snapshot = oxygenRuntimeSnapshotSchema.parse(
          await oxygenRuntimeRpc(worker, 'worker_status', id)
        );
        const command =
          job.kind === 'address'
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
              idempotencyKey: job.retryKey ?? job.id,
              command,
            })
          );
        if (queued.status === 'succeeded') continue;
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
      } catch {
        complete = false;
      }
    }
    await callbackRpc(worker, partner, complete ? 'complete' : 'defer', {
      id: job.id,
    });
  }
}
