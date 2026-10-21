import {
  forwardSharedCartWrite,
  installSharedCartWriter,
  retireSharedCartWriter,
  sharedCartWriteRevision,
  sharedCartWriterGeneration,
} from './shared-cart-writer';

it('fences writes synchronously before retiring the device, without clearing the server cart', async () => {
  const write = jest.fn();
  const retire = jest.fn().mockResolvedValue(undefined);
  const release = installSharedCartWriter({
    write,
    onError: jest.fn(),
    retire,
  });
  const generation = sharedCartWriterGeneration();
  const retiring = retireSharedCartWriter();
  expect(sharedCartWriterGeneration()).not.toBe(generation);
  await expect(forwardSharedCartWrite({ type: 'clear' })).rejects.toThrow();
  await retiring;
  expect(write).not.toHaveBeenCalled();
  expect(retire).toHaveBeenCalledTimes(1);
  release();
});
it('retires the current owner independently while a previous device is still waiting', async () => {
  let finish: () => void = () => {};
  const first = installSharedCartWriter({
    write: jest.fn(),
    onError: jest.fn(),
    retire: () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  });
  const pending = retireSharedCartWriter();
  await Promise.resolve();
  const retire = jest.fn().mockResolvedValue(undefined);
  const second = installSharedCartWriter({
    write: jest.fn(),
    onError: jest.fn(),
    retire,
  });
  await retireSharedCartWriter();
  expect(retire).toHaveBeenCalledTimes(1);
  finish();
  await pending;
  first();
  second();
});

it('advances checkout intent revision before a queued writer executes', async () => {
  const write = jest.fn().mockResolvedValue(undefined);
  const release = installSharedCartWriter({ write, onError: jest.fn() });
  const before = sharedCartWriteRevision();
  try {
    const pending = forwardSharedCartWrite({ type: 'clear' });
    expect(sharedCartWriteRevision()).toBe(before + 1);
    expect(write).not.toHaveBeenCalled();
    await pending;
    expect(write).toHaveBeenCalledTimes(1);
  } finally {
    release();
  }
});
it('does not treat lifecycle reconciliation as a new shopper edit', async () => {
  const release = installSharedCartWriter({
    write: jest.fn().mockResolvedValue(undefined),
    onError: jest.fn(),
  });
  const before = sharedCartWriteRevision();
  try {
    await forwardSharedCartWrite({ type: 'legacy_reprice' });
    expect(sharedCartWriteRevision()).toBe(before);
  } finally {
    release();
  }
});
