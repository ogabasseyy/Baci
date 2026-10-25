import 'server-only';
import { z } from 'zod';
import {
  type OxygenTransientFile,
  oxygenProviderContextSchema,
  oxygenProviderStateSchema,
  oxygenRuntimeSubmissionSchema,
} from '@/schemas/oxygen-runtime';
import { oxygenActiveLoanCode } from './booking-rejection';
import { type OxygenProvider, OxygenProviderFailure } from './provider';
import { oxygenDiagnostic } from './provider-diagnostic';
import { recordOxygenFailure } from './record-failure';
import { executeOxygenAction, oxygenActionAllowed } from './runtime-executor';
import { trackOxygenExecution } from './runtime-failure';

export interface OxygenRuntimeRpc {
  rpc(
    name: string,
    args: Record<string, unknown>
  ): PromiseLike<{ data: unknown; error: { code?: string } | null }>;
}
export {
  type OxygenRuntimeSnapshot,
  oxygenRuntimeSnapshotSchema,
} from '@/schemas/oxygen-runtime-view';

import {
  type OxygenRuntimeSnapshot,
  oxygenRuntimeSnapshotSchema,
} from '@/schemas/oxygen-runtime-view';
export async function oxygenRuntimeRpc(
  client: OxygenRuntimeRpc,
  operation: string,
  id: string,
  payload: Record<string, unknown> = {}
): Promise<unknown> {
  const { data, error } = await client.rpc('oxygen_runtime', {
    p_operation: operation,
    p_id: id,
    p_payload: payload,
  });
  if (error) throw new Error('Workflow unavailable');
  return data;
}
export async function readOxygenSnapshot(
  client: OxygenRuntimeRpc,
  id: string
): Promise<OxygenRuntimeSnapshot> {
  return oxygenRuntimeSnapshotSchema.parse(
    await oxygenRuntimeRpc(client, 'status', id)
  );
}
export async function performOxygenAction(
  user: OxygenRuntimeRpc,
  workerClient: () => Promise<OxygenRuntimeRpc>,
  provider: OxygenProvider,
  partnerReference: string,
  hosts: ReadonlySet<string>,
  input: unknown,
  file?: OxygenTransientFile
): Promise<OxygenRuntimeSnapshot> {
  const request = oxygenRuntimeSubmissionSchema.parse(input);
  const current = await readOxygenSnapshot(user, request.workflowId);
  if (!current.executionEnabled || current.version !== request.version)
    throw new Error('Workflow unavailable');
  if (
    request.command.action === 'book' &&
    current.bookingBlock === 'active_loan'
  )
    throw new OxygenProviderFailure('rejected', oxygenActiveLoanCode);
  // This preflight uses only public facts. The worker rechecks its private context.
  if (
    !oxygenActionAllowed(
      {
        stage: current.stage,
        environment: current.environment,
        state: current.state,
      },
      request.command
    )
  )
    throw new Error('Action unavailable at this stage');
  if (request.command.action === 'approve_booking' && !current.approvalOtpReady)
    throw new Error('Approval OTP required');
  const { action } = request.command;
  const command =
    request.command.action === 'book'
      ? {
          action,
          equityPercentage: request.command.equityPercentage,
          tenure: request.command.tenure,
        }
      : { action };
  const queued = z.object({ commandId: z.uuid(), status: z.string() }).parse(
    await oxygenRuntimeRpc(user, 'enqueue', request.workflowId, {
      version: request.version,
      idempotencyKey: request.idempotencyKey,
      command,
    })
  );
  const worker = await workerClient();
  const raw = await oxygenRuntimeRpc(worker, 'claim', queued.commandId, {
    commandId: queued.commandId,
  });
  if (raw === null) return readOxygenSnapshot(user, request.workflowId);
  const execution = trackOxygenExecution(
    provider.forCommand?.(worker, request.workflowId, queued.commandId) ??
      provider
  );
  const startedAt = Date.now();
  let result: Awaited<ReturnType<typeof executeOxygenAction>>;
  try {
    const claimed = z
      .object({
        context: oxygenProviderContextSchema,
        command: z.record(z.string(), z.unknown()),
      })
      .parse(raw);
    // Do not execute a replay using a different command or provider binding.
    if (
      JSON.stringify(claimed.command) !== JSON.stringify(command) &&
      JSON.stringify(
        Object.fromEntries(Object.entries(claimed.command).sort())
      ) !== JSON.stringify(Object.fromEntries(Object.entries(command).sort()))
    )
      throw new Error('Workflow command mismatch');
    if (
      claimed.context.workflowId !== request.workflowId ||
      claimed.context.partnerReference !== partnerReference
    )
      throw new Error('Provider binding mismatch');
    result = await executeOxygenAction(
      claimed.context,
      request.command,
      execution.provider,
      hosts,
      file
    );
    result.state = oxygenProviderStateSchema.parse(result.state);
  } catch (failure) {
    const outcome = execution.uncertain() ? 'indeterminate' : 'failed';
    const diagnostic =
      failure instanceof OxygenProviderFailure && failure.diagnostic
        ? failure.diagnostic
        : oxygenDiagnostic(
            execution.operation(),
            'validation',
            execution.uncertain() ? 'indeterminate' : 'not_sent',
            startedAt
          );
    await recordOxygenFailure(
      worker,
      queued.commandId,
      request.workflowId,
      execution.uncertain() ? 'reconciliation_required' : current.stage,
      outcome,
      diagnostic
    );
    if (
      !execution.uncertain() &&
      failure instanceof OxygenProviderFailure &&
      failure.code
    )
      throw failure;
    throw new Error(
      execution.uncertain()
        ? 'Provider result requires reconciliation'
        : 'Action failed; please check the details and try again'
    );
  }
  // A failed durable write leaves executing intent in place; never send again.
  await oxygenRuntimeRpc(worker, 'finish', queued.commandId, {
    commandId: queued.commandId,
    outcome: 'succeeded',
    ...result,
  });
  return readOxygenSnapshot(user, request.workflowId);
}
