import {
  createKeyedSerialAsyncQueue,
  createSerialAsyncQueue,
} from './create-serial-async-queue';

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

it('serializes operations sharing a key while other keys proceed', async () => {
  const enqueue = createKeyedSerialAsyncQueue();
  const seen: string[] = [];
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let firstStarted!: () => void;
  const firstEntered = new Promise<void>((resolve) => {
    firstStarted = resolve;
  });

  const first = enqueue('gen-a', async () => {
    firstStarted();
    await firstGate;
    seen.push('a1');
  });
  const second = enqueue('gen-a', async () => {
    seen.push('a2');
  });
  const other = enqueue('gen-b', async () => {
    seen.push('b1');
  });

  await firstEntered;
  await other;
  expect(seen).toEqual(['b1']);
  releaseFirst();
  await Promise.all([first, second]);
  expect(seen).toEqual(['b1', 'a1', 'a2']);
});
