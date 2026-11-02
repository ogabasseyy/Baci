import 'server-only';
import { readOxygenActivationBindings } from './activation-binding';
import { reconcileOxygenActivation } from './activation-reconciliation';
import {
  type OxygenActivationTrialOperation,
  readOxygenActivationTrial,
  runOxygenActivationTrial,
} from './activation-trial';
import type { OxygenRuntimeRpc } from './runtime-service';

/** Only the explicitly authorized staging booking has this capability.
 * The database requires durable payment confirmation and claims at most once. */
export async function completeOxygenPaidActivation(
  worker: OxygenRuntimeRpc,
  workflow: string,
  request: (
    operation: OxygenActivationTrialOperation,
    reference: string
  ) => Promise<Response>,
  key: string
) {
  const binding = readOxygenActivationBindings().find(
    (entry) => entry.workflowId === workflow
  );
  if (!binding) return;
  const state = await readOxygenActivationTrial(worker, binding.reference);
  if (state.status === 'activated' && !state.orderConfirmed) {
    await reconcileOxygenActivation(worker, binding.reference);
    return;
  }
  if (state.status !== 'ready') return;
  await runOxygenActivationTrial(
    worker,
    worker,
    request,
    key,
    binding.reference
  );
  const after = await readOxygenActivationTrial(worker, binding.reference);
  if (after.status === 'activated' && !after.orderConfirmed)
    await reconcileOxygenActivation(worker, binding.reference);
}
