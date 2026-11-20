import 'server-only';
import { z } from 'zod';
import {
  oxygenProviderContextSchema,
  oxygenProviderStateSchema,
} from '@/schemas/oxygen-runtime';
import { oxygenLocalValidationDiagnostic } from './local-validation-diagnostic';
import {
  oxygenOffersRecipient,
  sendOxygenOffersReady,
} from './offers-ready-notification';
import { type OxygenProvider, OxygenProviderFailure } from './provider';
import { recordOxygenFailure } from './record-failure';
import { executeOxygenAction } from './runtime-executor';
import { trackOxygenExecution } from './runtime-failure';
import { type OxygenRuntimeRpc, oxygenRuntimeRpc } from './runtime-service';

const command = { action: 'refresh_eligibility' } as const;
const checkClaim = z.object({ workflowId: z.uuid(), commandId: z.uuid() });
const checkContext = z.object({
  command: z.object({ action: z.literal(command.action) }).strict(),
  context: oxygenProviderContextSchema,
});

type Options = {
  worker: OxygenRuntimeRpc;
  provider: OxygenProvider;
  partner: string;
  environment: 'staging' | 'production';
  hosts: ReadonlySet<string>;
  deadlineMs: number;
};

async function queueRpc(
  { worker, partner, environment }: Options,
  operation: string,
  payload: Record<string, string> = {}
) {
  const { data, error } = await worker.rpc('oxygen_eligibility_background', {
    p_operation: operation,
    p_partner: partner,
    p_environment: environment,
    p_payload: payload,
  });
  if (error) throw new Error('Oxygen eligibility queue unavailable');
  return data;
}

async function checkEligibility(
  options: Options,
  item: z.infer<typeof checkClaim>
) {
  const { worker, partner, environment, hosts, provider } = options;
  const { commandId, workflowId } = item;
  const raw = await oxygenRuntimeRpc(worker, 'claim', commandId, { commandId });
  if (raw === null) return;
  const { context } = checkContext.parse(raw);
  if (
    context.workflowId !== workflowId ||
    context.partnerReference !== partner ||
    context.environment !== environment
  ) {
    throw new Error('Oxygen eligibility binding mismatch');
  }
  const execution = trackOxygenExecution(
    provider.forCommand?.(worker, workflowId, commandId) ?? provider
  );
  const startedAt = Date.now();
  let result: Awaited<ReturnType<typeof executeOxygenAction>>;
  try {
    result = await executeOxygenAction(
      context,
      command,
      execution.provider,
      hosts
    );
    result.state = oxygenProviderStateSchema.parse(result.state);
  } catch (failure) {
    await recordOxygenFailure(
      worker,
      commandId,
      workflowId,
      context.stage,
      'failed',
      failure instanceof OxygenProviderFailure && failure.diagnostic
        ? failure.diagnostic
        : oxygenLocalValidationDiagnostic(
            failure,
            execution.operation(),
            execution.responseMetadata(),
            startedAt,
            false
          )
    );
    return;
  }
  await oxygenRuntimeRpc(worker, 'finish', commandId, {
    commandId,
    outcome: 'succeeded',
    ...result,
  });
}

export async function runOxygenEligibilityBackground(options: Options) {
  const hasTime = () => options.deadlineMs - Date.now() >= 75_000;
  for (let count = 0; count < 2 && hasTime(); count++) {
    const item = checkClaim
      .nullable()
      .parse(await queueRpc(options, 'claim_check'));
    if (!item) break;
    await checkEligibility(options, item);
  }
  if (options.environment !== 'production') return;
  for (let count = 0; count < 2 && hasTime(); count++) {
    const recipient = oxygenOffersRecipient
      .nullable()
      .parse(await queueRpc(options, 'claim_notification'));
    if (!recipient) break;
    let delivered = false;
    try {
      delivered = await sendOxygenOffersReady(recipient, options.deadlineMs);
    } finally {
      await queueRpc(options, 'finish_notification', {
        workflowId: recipient.workflowId,
        status: delivered ? 'sent' : 'unconfirmed',
      });
    }
  }
}
