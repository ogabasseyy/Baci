import 'server-only';
import { z } from 'zod';
import { oxygenActivationBinding } from './activation-binding';
import type { OxygenRuntimeRpc } from './runtime-service';

/** Reconcile stored activation evidence only. Never calls Oxygen or settles funds. */
export async function reconcileOxygenActivation(
  worker: OxygenRuntimeRpc,
  reference: string
) {
  const binding = oxygenActivationBinding(reference);
  if (!binding) throw new Error('Activation reconciliation unavailable');
  const { data, error } = await worker.rpc('oxygen_reconcile_activation', {
    p_workflow_id: binding.workflowId,
    p_reference: binding.reference,
  });
  if (error) throw new Error('Activation reconciliation unavailable');
  return z.object({ orderConfirmed: z.literal(true) }).parse(data);
}
