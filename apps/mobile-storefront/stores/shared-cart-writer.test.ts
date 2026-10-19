import {
  forwardSharedCartWrite,
  installSharedCartWriter,
  retireSharedCartWriter,
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
