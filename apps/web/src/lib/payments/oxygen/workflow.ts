import type {
  OxygenWorkflowCommand,
  OxygenWorkflowStage,
} from '@/schemas/oxygen-workflow';

type Action = OxygenWorkflowCommand['action'];
const allowedStages: Record<Action, readonly OxygenWorkflowStage[]> = {
  start_application: ['application_required'],
  refresh_eligibility: [
    'eligibility_required',
    'kyc_required',
    'plan_required',
  ],
  refresh_kyc: ['kyc_required', 'plan_required', 'booked', 'approval_required'],
  book: ['plan_required'],
  cancel_booking: ['booked', 'approval_required'],
  refresh_payment_setup: ['payment_required', 'ready_for_activation'],
};
const results: Record<Action, readonly OxygenWorkflowStage[]> = {
  start_application: ['eligibility_required'],
  refresh_eligibility: [
    'eligibility_required',
    'kyc_required',
    'plan_required',
  ],
  refresh_kyc: ['kyc_required', 'plan_required', 'booked', 'approval_required'],
  book: ['booked', 'approval_required'],
  cancel_booking: ['plan_required'],
  refresh_payment_setup: ['payment_required', 'ready_for_activation'],
};
export function commandAllowed(
  stage: OxygenWorkflowStage,
  command: OxygenWorkflowCommand
): boolean {
  return allowedStages[command.action].includes(stage);
}
export function projectWorkflow(stage: OxygenWorkflowStage) {
  return {
    stage,
    actions: (Object.keys(allowedStages) as Action[]).filter((action) =>
      allowedStages[action].includes(stage)
    ),
    nextStep: stage === 'ready_for_activation' ? 'activation_disabled' : stage,
    settlement: 'unverified' as const,
  };
}
export interface ClaimedOxygenCommand {
  id: string;
  environment: 'staging' | 'production';
  stage: OxygenWorkflowStage;
  command: OxygenWorkflowCommand;
}
export interface OxygenWorkflowWorkerStore {
  // Must atomically persist execution intent; never re-claim executing work.
  claim(): Promise<ClaimedOxygenCommand | null>;
  record(
    id: string,
    outcome: 'succeeded' | 'indeterminate',
    stage: OxygenWorkflowStage
  ): Promise<void>;
}
/** A provider timeout is indeterminate. No automatic retries of financial work. */
export async function runWorkflowCommand(
  store: OxygenWorkflowWorkerStore,
  execute: (command: ClaimedOxygenCommand) => Promise<OxygenWorkflowStage>
): Promise<void> {
  const claimed = await store.claim();
  if (!claimed) return;
  let stage: OxygenWorkflowStage;
  try {
    if (claimed.environment !== 'staging')
      throw new Error('Production execution disabled');
    if (!commandAllowed(claimed.stage, claimed.command))
      throw new Error('Invalid stage');
    stage = await execute(claimed);
    if (!results[claimed.command.action].includes(stage))
      throw new Error('Invalid result');
  } catch {
    await store.record(claimed.id, 'indeterminate', 'reconciliation_required');
    return;
  }
  // If recording fails, intent remains executing. An operator must reconcile it.
  await store.record(claimed.id, 'succeeded', stage);
}
