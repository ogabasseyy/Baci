import { createKeyedSerialAsyncQueue } from './create-keyed-serial-async-queue';

it('runs same-key operations in order even when they overlap', async () => {
  const enqueue = createKeyedSerialAsyncQueue();
  const seen: number[] = [];
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  const first = enqueue('gen', async () => {
    await firstGate;
    seen.push(1);
  });
  const second = enqueue('gen', async () => {
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

it('resets one key without disturbing other keys', async () => {
  const enqueue = createKeyedSerialAsyncQueue();
  const seen: string[] = [];
  let releaseHungA!: () => void;
  const hungAGate = new Promise<void>((resolve) => {
    releaseHungA = resolve;
  });
  let enteredA!: () => void;
  const enteredAPromise = new Promise<void>((resolve) => {
    enteredA = resolve;
  });
  let enteredB!: () => void;
  const enteredBPromise = new Promise<void>((resolve) => {
    enteredB = resolve;
  });

  const hungA = enqueue('gen-a', async () => {
    enteredA();
    await hungAGate;
    seen.push('a1');
  });
  let releaseHungB!: () => void;
  const hungBGate = new Promise<void>((resolve) => {
    releaseHungB = resolve;
  });
  const hungB = enqueue('gen-b', async () => {
    enteredB();
    await hungBGate;
    seen.push('b1');
  });
  await enteredAPromise;
  await enteredBPromise;

  enqueue.resetKey('gen-a');
  await enqueue('gen-a', async () => {
    seen.push('a2');
  });
  expect(seen).toEqual(['a2']);

  const secondB = enqueue('gen-b', async () => {
    seen.push('b2');
  });
  let secondBRan = false;
  void secondB.then(() => {
    secondBRan = true;
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(secondBRan).toBe(false);

  releaseHungA();
  releaseHungB();
  await Promise.all([hungA, hungB, secondB]);
  expect(seen).toEqual(['a2', 'a1', 'b1', 'b2']);
});
