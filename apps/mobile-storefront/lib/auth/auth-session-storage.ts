import type { SupportedStorage } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { createLogger } from '../logger';
import { authStorageTimeout } from './auth-storage-timeout';

const log = createLogger('AuthSessionStorage');
type StorageIntent =
  | {
      operation?: Promise<void>;
      pending: boolean;
      revision: number;
      retryAfterFailure?: boolean;
      type: 'delete';
    }
  | {
      operation?: Promise<void>;
      pending: boolean;
      revision: number;
      retryAfterFailure?: boolean;
      type: 'set';
      value: string;
    };
type StorageIntentInput = { type: 'delete' } | { type: 'set'; value: string };
type StorageRollbackBaseline = {
  pending: boolean;
  value: string | null;
};
type DeadlineAwareStorage = SupportedStorage & {
  getItem: (key: string, deadline?: number) => Promise<string | null>;
  removeItem: (key: string, deadline?: number) => Promise<void>;
  setItem: (key: string, value: string, deadline?: number) => Promise<void>;
};
const storageIntents = new Map<string, StorageIntent>();
const storageMutationQueues = new Map<string, Promise<void>>();
async function runSerializedStorageMutation<T>(
  key: string,
  mutation: () => Promise<T>,
  deadline?: number
): Promise<T> {
  const previousMutation = storageMutationQueues.get(key) ?? Promise.resolve();
  const result = authStorageTimeout
    .run(
      previousMutation.catch(() => undefined),
      'mutation queue',
      authStorageTimeout.defaultMs,
      deadline
    )
    .then(mutation);
  const queueTail = result.then(
    () => undefined,
    () => undefined
  );
  storageMutationQueues.set(key, queueTail);
  try {
    return await result;
  } finally {
    if (storageMutationQueues.get(key) === queueTail) {
      storageMutationQueues.delete(key);
    }
  }
}
function nextStorageIntent(
  key: string,
  intent: StorageIntentInput
): StorageIntent {
  const revision = (storageIntents.get(key)?.revision ?? 0) + 1;
  const nextIntent = { ...intent, pending: true, revision } as StorageIntent;
  storageIntents.set(key, nextIntent);
  return nextIntent;
}

async function reconcileLatestStorageIntent(key: string): Promise<void> {
  while (true) {
    const intent = storageIntents.get(key);
    if (!intent?.pending) return;
    const operation =
      intent.operation ??
      (intent.type === 'set'
        ? SecureStore.setItemAsync(key, intent.value)
        : SecureStore.deleteItemAsync(key));
    intent.operation = operation;
    fenceLateMutation(key, intent, operation);
    try {
      await authStorageTimeout.run(operation, 'reconciliation');
    } catch (error) {
      if (storageIntents.get(key)?.revision === intent.revision) {
        intent.operation = undefined;
      }
      log.warn(
        'Unable to reconcile the latest Supabase auth session state.',
        error
      );
      return;
    }
    if (storageIntents.get(key)?.revision === intent.revision) return;
  }
}
function fenceLateMutation(
  key: string,
  intent: StorageIntent,
  operation: Promise<void>
): void {
  operation.then(
    () => {
      const currentIntent = storageIntents.get(key);
      if (currentIntent?.revision === intent.revision) {
        currentIntent.pending = false;
        currentIntent.operation = undefined;
      } else if (currentIntent) {
        currentIntent.pending = true;
        void reconcileLatestStorageIntent(key);
      }
    },
    () => {
      const currentIntent = storageIntents.get(key);
      if (
        currentIntent?.revision === intent.revision &&
        intent.retryAfterFailure
      ) {
        currentIntent.operation = undefined;
        currentIntent.pending = true;
        currentIntent.retryAfterFailure = false;
        void reconcileLatestStorageIntent(key);
      }
    }
  );
}

function restorePreviousStorageIntent(
  key: string,
  baseline: StorageRollbackBaseline,
  needsReconciliation: boolean
): void {
  const intent = nextStorageIntent(
    key,
    baseline.value === null
      ? { type: 'delete' }
      : { type: 'set', value: baseline.value }
  );
  intent.pending = baseline.pending || needsReconciliation;
  if (intent.pending) void reconcileLatestStorageIntent(key);
}
async function readAuthStorageItem(
  key: string,
  deadline = Date.now() + authStorageTimeout.defaultMs
): Promise<string | null> {
  const intent = storageIntents.get(key);
  if (intent?.pending) {
    if (intent.type === 'delete') {
      void reconcileLatestStorageIntent(key);
      return null;
    }
    if (intent.operation) {
      try {
        await authStorageTimeout.run(
          intent.operation,
          'pending mutation',
          authStorageTimeout.remaining(deadline)
        );
      } catch {
        return null;
      }
    }
    const latestIntent = storageIntents.get(key);
    if (!latestIntent?.pending) {
      return readAuthStorageItem(key, deadline);
    }
    await authStorageTimeout.run(
      reconcileLatestStorageIntent(key),
      'reconciliation',
      authStorageTimeout.remaining(deadline)
    );
    if (storageIntents.get(key)?.pending) return null;
  }

  const revisionBeforeRead = storageIntents.get(key)?.revision;
  const value = await authStorageTimeout.run(
    SecureStore.getItemAsync(key),
    'read',
    authStorageTimeout.remaining(deadline)
  );
  const intentAfterRead = storageIntents.get(key);
  if (intentAfterRead?.pending) return null;
  if (intentAfterRead?.revision !== revisionBeforeRead) {
    return readAuthStorageItem(key, deadline);
  }
  return value;
}

async function captureRollbackBaseline(
  key: string,
  deadline?: number
): Promise<StorageRollbackBaseline> {
  const logicalIntent = storageIntents.get(key);
  if (logicalIntent) {
    return {
      pending: logicalIntent.pending,
      value: logicalIntent.type === 'delete' ? null : logicalIntent.value,
    };
  }

  try {
    const value = await authStorageTimeout.run(
      SecureStore.getItemAsync(key),
      'rollback snapshot',
      authStorageTimeout.defaultMs,
      deadline
    );
    return { pending: false, value };
  } catch (error) {
    log.warn('Unable to capture the Supabase auth rollback baseline.', error);
    throw error;
  }
}

export const authSessionStorage: DeadlineAwareStorage = {
  getItem: async (key: string, deadline?: number) => {
    try {
      return await readAuthStorageItem(key, deadline);
    } catch (error) {
      log.warn('Unable to read the Supabase auth session state.', error);
      return null;
    }
  },
  setItem: (key: string, value: string, deadline?: number) =>
    runSerializedStorageMutation(
      key,
      async () => {
        const baseline = await captureRollbackBaseline(key, deadline);
        const intent = nextStorageIntent(key, { type: 'set', value });
        const operation = SecureStore.setItemAsync(key, value);
        intent.operation = operation;
        fenceLateMutation(key, intent, operation);
        try {
          await authStorageTimeout.run(
            operation,
            'write',
            authStorageTimeout.defaultMs,
            deadline
          );
        } catch (error) {
          if (storageIntents.get(key)?.revision === intent.revision) {
            if (deadline !== undefined && authStorageTimeout.isTimeout(error)) {
              // The provider may already have rotated the one-time refresh
              // token. Keep the new credentials as the logical intent while
              // the original SecureStore write settles instead of restoring
              // credentials that the provider may have consumed.
              intent.pending = true;
              intent.retryAfterFailure = true;
            } else {
              restorePreviousStorageIntent(
                key,
                baseline,
                authStorageTimeout.isTimeout(error)
              );
            }
          }
          log.warn(
            'Unable to persist Supabase auth session in SecureStore.',
            error
          );
          throw error;
        }
      },
      deadline
    ),
  removeItem: (key: string, deadline?: number) =>
    runSerializedStorageMutation(
      key,
      async () => {
        const baseline = await captureRollbackBaseline(key, deadline);
        const intent = nextStorageIntent(key, { type: 'delete' });
        const operation = SecureStore.deleteItemAsync(key);
        intent.operation = operation;
        fenceLateMutation(key, intent, operation);
        try {
          await authStorageTimeout.run(
            operation,
            'delete',
            authStorageTimeout.defaultMs,
            deadline
          );
        } catch (error) {
          if (storageIntents.get(key)?.revision === intent.revision) {
            restorePreviousStorageIntent(
              key,
              baseline,
              authStorageTimeout.isTimeout(error)
            );
          }
          throw error;
        }
      },
      deadline
    ),
};
