import { createKeyedSerialAsyncQueue } from '@/lib/create-keyed-serial-async-queue';

let enqueueKeyed = createKeyedSerialAsyncQueue();

export function enqueueCheckoutGenerationStorage<T>(
  operation: () => Promise<T>
): Promise<T> {
  return enqueueKeyed('checkout-generation', operation);
}

export function resetCheckoutGenerationStorageQueue(): void {
  enqueueKeyed = createKeyedSerialAsyncQueue();
}
