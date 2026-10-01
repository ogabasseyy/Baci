import { authStorageTimeout } from './auth-storage-timeout';

describe('authStorageTimeout', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('uses the caller deadline when it is shorter than the storage timeout', async () => {
    jest.useFakeTimers();
    const operation = new Promise<string>((resolve) => {
      setTimeout(() => resolve('late'), 200);
    });
    const result = authStorageTimeout.run(
      operation,
      'test read',
      authStorageTimeout.defaultMs,
      Date.now() + 100
    );
    const expectation = expect(result).rejects.toThrow(
      'Supabase auth storage test read timed out'
    );

    await jest.advanceTimersByTimeAsync(100);

    await expectation;
  });
});
