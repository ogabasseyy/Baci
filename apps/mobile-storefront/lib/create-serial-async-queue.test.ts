import { createSerialAsyncQueue } from './create-serial-async-queue';

it('runs queued operations in order even when they overlap', async () => {
  const enqueue = createSerialAsyncQueue();
  const seen: number[] = [];
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  const first = enqueue(async () => {
    await firstGate;
    seen.push(1);
  });
  const second = enqueue(async () => {
    seen.push(2);
  });

  expect(seen).toEqual([]);
  releaseFirst();
  await Promise.all([first, second]);
  expect(seen).toEqual([1, 2]);
});
