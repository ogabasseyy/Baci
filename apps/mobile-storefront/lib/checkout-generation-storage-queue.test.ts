import { checkoutGenerationStorageQueue } from './checkout-generation-storage-queue';

beforeEach(() => {
  checkoutGenerationStorageQueue.reset();
});

it('runs enqueued storage operations serially in order', async () => {
  const order: number[] = [];
  const first = checkoutGenerationStorageQueue.enqueue(async () => {
    order.push(1);
    return 'first';
  });
  const second = checkoutGenerationStorageQueue.enqueue(async () => {
    order.push(2);
    return 'second';
  });
  await expect(first).resolves.toBe('first');
  await expect(second).resolves.toBe('second');
  expect(order).toEqual([1, 2]);
});

it('keeps the queue usable after a rejected operation', async () => {
  const failing = checkoutGenerationStorageQueue.enqueue(async () => {
    throw new Error('disk full');
  });
  const next = checkoutGenerationStorageQueue.enqueue(async () => 'recovered');
  await expect(failing).rejects.toThrow('disk full');
  await expect(next).resolves.toBe('recovered');
});

it('lets new operations proceed on a reset queue while an older write hangs', async () => {
  checkoutGenerationStorageQueue.enqueue(
    () => new Promise<never>(() => undefined)
  );
  checkoutGenerationStorageQueue.reset();
  await expect(
    checkoutGenerationStorageQueue.enqueue(async () => 'after-reset')
  ).resolves.toBe('after-reset');
});
