import { withCheckoutStorageTimeout } from './with-checkout-storage-timeout';

afterEach(() => {
  jest.useRealTimers();
});

it('resolves when the storage write settles before the timeout', async () => {
  await expect(
    withCheckoutStorageTimeout(Promise.resolve('ok'), 1_000)
  ).resolves.toBe('ok');
});

it('rejects when the storage write never settles', async () => {
  jest.useFakeTimers();
  const hung = withCheckoutStorageTimeout(new Promise(() => undefined), 5_000);
  const expectation = expect(hung).rejects.toThrow(
    'Checkout storage write timed out'
  );
  await jest.advanceTimersByTimeAsync(5_000);
  await expectation;
});
