import {
  type OxygenRuntimeSnapshot,
  pendingReadRecovery,
} from '@baci/shared/oxygen';
import type { OxygenClient } from './client';
import { OxygenClientError } from './errors';
export async function retireOxygenQueued(
  client: OxygenClient,
  snapshot: OxygenRuntimeSnapshot,
  kind: 'address' | 'phone'
) {
  const pending = snapshot.pending;
  if (!pending) throw new OxygenClientError('recovery');
  const request = {
    workflowId: snapshot.workflowId,
    version: snapshot.version,
    idempotencyKey: pending.idempotencyKey,
  };
  if (kind === 'address') {
    if (
      pendingReadRecovery(snapshot) !== 'submit_address' ||
      !snapshot.state.bookingReference
    )
      throw new OxygenClientError('recovery');
    await client.retireAddress({
      ...request,
      bookingReference: snapshot.state.bookingReference,
    });
  } else {
    if (
      !snapshot.executionEnabled ||
      pending.status !== 'queued' ||
      pending.action !== 'validate_customer' ||
      snapshot.state.validated ||
      !snapshot.state.applicationReference ||
      snapshot.state.bookingReference
    )
      throw new OxygenClientError('recovery');
    await client.retirePhone(request);
  }
}
