import { createSerialAsyncQueue } from '@/lib/create-serial-async-queue';

export const enqueueCheckoutGenerationStorage = createSerialAsyncQueue();
