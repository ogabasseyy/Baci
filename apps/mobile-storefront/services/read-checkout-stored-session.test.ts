import { jest } from '@jest/globals';

const mockWarn = jest.fn();

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: mockWarn }),
}));

const { readCheckoutStoredSession } =
  require('./read-checkout-stored-session') as typeof import('./read-checkout-stored-session');

it('marks a timed-out send-boundary read as inconclusive instead of guest', async () => {
  jest.useFakeTimers();
  const result = readCheckoutStoredSession(
    { getItem: jest.fn(() => new Promise<never>(() => undefined)) },
    'auth-key',
    100
  );

  await jest.advanceTimersByTimeAsync(100);

  await expect(result).resolves.toEqual({ session: null, timedOut: true });
  jest.useRealTimers();
});
