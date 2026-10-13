import { jest } from '@jest/globals';
import type { Session } from '@supabase/supabase-js';

const mockWarn = jest.fn();
const mockSecureStoreGetItem = jest.fn<() => Promise<string | null>>();

jest.mock('expo-secure-store', () => ({
  deleteItemAsync: jest.fn(async () => undefined),
  getItemAsync: mockSecureStoreGetItem,
  setItemAsync: jest.fn(async () => undefined),
}));

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: mockWarn }),
}));

const { authSessionStorage } =
  require('@/lib/auth/auth-session-storage') as typeof import('@/lib/auth/auth-session-storage');
const { resolveCheckoutAuth } =
  require('./orders-auth') as typeof import('./orders-auth');

function session(accessToken: string): Session {
  return {
    access_token: accessToken,
    refresh_token: 'refresh-token',
    user: { id: 'user-a' },
  } as Session;
}

describe('resolveCheckoutAuth storage deadline', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('ends a refresh when cumulative storage phases exhaust the checkout deadline', async () => {
    jest.useFakeTimers();
    let refreshSettled = false;
    mockSecureStoreGetItem.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve('{}'), 2_500);
        })
    );
    const auth = {
      refreshSession: jest.fn(
        async (currentSession?: { storage_deadline_at?: number }) => {
          const deadline = currentSession?.storage_deadline_at;
          try {
            for (let phase = 0; phase < 4; phase += 1) {
              const value = await authSessionStorage.getItem(
                'aggregate-key',
                deadline
              );
              if (value === null) throw new Error('Storage deadline exhausted');
            }
            return {
              data: { session: session('unexpected-token') },
              error: null,
            };
          } finally {
            refreshSettled = true;
          }
        }
      ),
    };

    const result = resolveCheckoutAuth(auth, session('stored-token'));
    await jest.advanceTimersByTimeAsync(9_000);

    await expect(result).resolves.toMatchObject({
      authorizationHeaders: {},
      canValidateUser: false,
      session: null,
    });
    expect(refreshSettled).toBe(true);
  });
});
