import { OxygenClientError } from './errors';
import type { OxygenWorkflowController } from './workflow';
/** A UI send is acknowledged only by fresh durable progress, never by a swallowed error. */
export async function resendOxygenPhoneCode(
  controller: Pick<OxygenWorkflowController, 'execute' | 'getState'>
) {
  const before = controller.getState();
  if (before.busy)
    throw new OxygenClientError('busy', undefined, 'not_dispatched');
  if (!before.snapshot)
    throw new OxygenClientError('recovery', undefined, 'not_dispatched');
  await controller.execute({ action: 'resend_customer_otp' });
  const after = controller.getState();
  if (after.error) throw after.error;
  if (
    after.busy ||
    !after.snapshot ||
    after.snapshot.pending ||
    after.snapshot.workflowId !== before.snapshot.workflowId ||
    after.snapshot.version <= before.snapshot.version ||
    after.snapshot.state.applicationReference !==
      before.snapshot.state.applicationReference
  )
    throw new OxygenClientError('recovery');
}
