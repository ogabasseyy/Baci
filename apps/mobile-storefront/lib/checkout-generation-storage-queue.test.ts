import {
  enqueueCheckoutGenerationStorage,
  resetCheckoutGenerationStorageQueue,
} from './checkout-generation-storage-queue';

beforeEach(() => {
  resetCheckoutGenerationStorageQueue();
});

it('runs enqueued storage operations serially in order', async () => {
  const order: number[] = [];
  const first = enqueueCheckoutGenerationStorage(async () => {
    order.push(1);
    return 'first';
  });
  const second = enqueueCheckoutGenerationStorage(async () => {
    order.push(2);
    return 'second';
  });
  await expect(first).resolves.toBe('first');
  await expect(second).resolves.toBe('second');
  expect(order).toEqual([1, 2]);
});

it('keeps the queue usable after a rejected operation', async () => {
  const failing = enqueueCheckoutGenerationStorage(async () => {
    throw new Error('disk full');
  });
  const next = enqueueCheckoutGenerationStorage(async () => 'recovered');
  await expect(failing).rejects.toThrow('disk full');
  await expect(next).resolves.toBe('recovered');
});

it('lets new operations proceed on a reset queue while an older write hangs', async () => {
  enqueueCheckoutGenerationStorage(() => new Promise<never>(() => undefined));
  resetCheckoutGenerationStorageQueue();
  await expect(
    enqueueCheckoutGenerationStorage(async () => 'after-reset')
  ).resolves.toBe('after-reset');
});
