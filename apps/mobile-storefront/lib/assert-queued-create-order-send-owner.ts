import { DeferredOfflineMutationError } from '@/lib/deferred-offline-mutation-error';
import { queuedCreateOrderOwnerMismatch } from '@/lib/queued-create-order-owner';

export function assertQueuedCreateOrderSendOwner(
  expectedOwner: string | undefined,
  sendUserIds: readonly (string | undefined)[]
): void {
  if (expectedOwner === undefined) {
    return;
  }
  if (
    sendUserIds.some((id) => queuedCreateOrderOwnerMismatch(expectedOwner, id))
  ) {
    throw new DeferredOfflineMutationError(
      'Queued checkout belongs to a different account'
    );
  }
}
