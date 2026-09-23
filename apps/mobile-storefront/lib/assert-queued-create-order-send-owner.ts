import { DeferredOfflineMutationError } from '@/lib/deferred-offline-mutation-error';
import { queuedCreateOrderOwnerMismatch } from '@/lib/queued-create-order-owner';

export const QUEUED_CREATE_ORDER_SESSION_TIMEOUT_MESSAGE =
  'Checkout session read timed out';

export function assertQueuedCreateOrderSendOwner(
  expectedOwner: string | undefined,
  input: {
    resolvedUserIds: readonly (string | undefined)[];
    storageReadInconclusive?: boolean;
    storageUserId?: string;
  }
): void {
  if (expectedOwner === undefined) {
    return;
  }

  const resolvedUserIds = input.resolvedUserIds.filter(
    (id): id is string => typeof id === 'string' && id.length > 0
  );
  if (
    resolvedUserIds.some((id) =>
      queuedCreateOrderOwnerMismatch(expectedOwner, id)
    )
  ) {
    throw new DeferredOfflineMutationError(
      'Queued checkout belongs to a different account'
    );
  }

  if (input.storageReadInconclusive) {
    if (resolvedUserIds.length > 0) {
      return;
    }
    throw new Error(QUEUED_CREATE_ORDER_SESSION_TIMEOUT_MESSAGE);
  }

  const authenticatedOwner = expectedOwner !== '' && expectedOwner !== 'guest';
  if (authenticatedOwner && !resolvedUserIds.includes(expectedOwner)) {
    if (input.storageUserId === expectedOwner) {
      throw new Error(
        'Queued checkout session is not authorized for this account'
      );
    }
    throw new DeferredOfflineMutationError(
      'Queued checkout belongs to a different account'
    );
  }

  if (queuedCreateOrderOwnerMismatch(expectedOwner, input.storageUserId)) {
    throw new DeferredOfflineMutationError(
      'Queued checkout belongs to a different account'
    );
  }
}
