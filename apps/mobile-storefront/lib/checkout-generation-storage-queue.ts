import { createKeyedSerialAsyncQueue } from '@/lib/create-keyed-serial-async-queue';

let enqueueKeyed = createKeyedSerialAsyncQueue();

function enqueueGenerationStorageOperation<T>(
  operation: () => Promise<T>
): Promise<T> {
  return enqueueKeyed('checkout-generation', operation);
}

function resetGenerationStorageQueue(): void {
  enqueueKeyed = createKeyedSerialAsyncQueue();
}

export const checkoutGenerationStorageQueue = {
  enqueue: enqueueGenerationStorageOperation,
  reset: resetGenerationStorageQueue,
};
