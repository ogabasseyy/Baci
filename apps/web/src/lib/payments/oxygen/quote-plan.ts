import 'server-only';
import { randomUUID } from 'node:crypto';
import type { OxygenPlanQuote } from '@/schemas/oxygen-plan-quote';
import { oxygenSavedPlansSchema } from '@/schemas/oxygen-saved-plans';
import type { OxygenProvider } from './provider';
import { oxygenActionAllowed } from './runtime-policy';
import {
  type OxygenRuntimeRpc,
  performOxygenAction,
  readOxygenSnapshot,
} from './runtime-service';

export class OxygenPlanQuoteError extends Error {
  constructor(
    public readonly code: 'unavailable' | 'blocked' | 'details_required'
  ) {
    super(code);
  }
}
async function saved(
  user: OxygenRuntimeRpc,
  workflowId: string,
  reference: string | null = null
) {
  const response = await user.rpc('oxygen_saved_plans', {
    p_workflow_id: workflowId,
    p_booking_reference: reference,
  });
  if (response.error) throw new OxygenPlanQuoteError('unavailable');
  return oxygenSavedPlansSchema.parse(response.data);
}
/** Uses the existing durable command ledger: one in-flight mutation per workflow.
 * Lost booking responses remain indeterminate; a confirmed booking with missing
 * details can only retry the read. A cached plan never invokes Oxygen. */
export async function quoteOxygenPlan(
  user: OxygenRuntimeRpc,
  connection: {
    provider: OxygenProvider;
    worker: () => Promise<OxygenRuntimeRpc>;
    partnerReference: string;
    hosts: ReadonlySet<string>;
  },
  input: OxygenPlanQuote
) {
  let snapshot = await readOxygenSnapshot(user, input.workflowId);
  const cache = await saved(user, input.workflowId);
  const productAmount = snapshot.state.booking?.product_amount;
  const match = cache.plans.find(
    (plan) =>
      plan.equityPercentage === input.equityPercentage &&
      plan.tenure === input.tenure &&
      (productAmount === undefined || plan.productAmount === productAmount)
  );
  if (
    snapshot.state.booking?.status === 'APPROVED' ||
    ['activated', 'payment_required', 'ready_for_activation'].includes(
      snapshot.stage
    )
  )
    throw new OxygenPlanQuoteError('blocked');
  // A cached plan must not hide a booking that still needs reconciliation.
  if (match && snapshot.pending?.action !== 'book')
    return saved(user, input.workflowId, match.bookingReference);
  const queuedBooking =
    snapshot.pending?.action === 'book' && snapshot.pending.status === 'queued'
      ? snapshot.pending
      : null;
  if (
    !snapshot.executionEnabled ||
    (snapshot.pending && !queuedBooking) ||
    (queuedBooking && input.idempotencyKey !== queuedBooking.idempotencyKey) ||
    snapshot.stage === 'reconciliation_required' ||
    snapshot.bookingBlock ||
    snapshot.approvalOtpReady
  )
    throw new OxygenPlanQuoteError('blocked');
  const current = snapshot.state.booking;
  const same =
    current?.status === 'BOOKED' &&
    current.equity_percentage === input.equityPercentage &&
    current.loan_tenure === input.tenure;
  const command = {
    action: 'book' as const,
    equityPercentage: input.equityPercentage,
    tenure: input.tenure,
  };
  const restrict = (source: OxygenProvider): OxygenProvider => {
    const bind = source.forCommand;
    return {
      environment: source.environment,
      ...(source.responseMetadata
        ? { responseMetadata: () => source.responseMetadata?.() }
        : {}),
      call(operation, payload) {
        if (operation !== 'book' && operation !== 'details')
          throw new OxygenPlanQuoteError('blocked');
        return source.call(operation, payload);
      },
      ...(bind
        ? {
            forCommand: (worker, workflowId, commandId) =>
              restrict(bind(worker, workflowId, commandId)),
          }
        : {}),
    };
  };
  const controlled = restrict(connection.provider);
  if (!same || queuedBooking) {
    if (
      !oxygenActionAllowed(
        {
          stage: snapshot.stage,
          environment: snapshot.environment,
          state: snapshot.state,
          bookingBlock: snapshot.bookingBlock,
        },
        command
      )
    )
      throw new OxygenPlanQuoteError('blocked');
    snapshot = await performOxygenAction(
      user,
      connection.worker,
      controlled,
      connection.partnerReference,
      connection.hosts,
      {
        workflowId: input.workflowId,
        version: snapshot.version,
        // The owned snapshot identifies the existing command. The enqueue RPC
        // compares its stored terms and version atomically before any claim.
        idempotencyKey: queuedBooking?.idempotencyKey ?? input.idempotencyKey,
        command,
      }
    );
    if (
      snapshot.pending ||
      snapshot.stage === 'reconciliation_required' ||
      snapshot.state.booking?.status !== 'BOOKED' ||
      snapshot.state.booking.equity_percentage !== input.equityPercentage ||
      snapshot.state.booking.loan_tenure !== input.tenure ||
      !snapshot.state.bookingReference
    )
      throw new OxygenPlanQuoteError('blocked');
  }
  // Do not book again if details or the response is lost after this point.
  await performOxygenAction(
    user,
    connection.worker,
    controlled,
    connection.partnerReference,
    connection.hosts,
    {
      workflowId: input.workflowId,
      version: snapshot.version,
      idempotencyKey: randomUUID(),
      command: { action: 'refresh_details' },
    }
  );
  const result = await saved(user, input.workflowId);
  const complete = result.plans.find(
    (plan) =>
      plan.equityPercentage === input.equityPercentage &&
      plan.tenure === input.tenure &&
      plan.bookingReference === snapshot.state.bookingReference
  );
  if (!complete) throw new OxygenPlanQuoteError('details_required');
  return saved(user, input.workflowId, complete.bookingReference);
}
