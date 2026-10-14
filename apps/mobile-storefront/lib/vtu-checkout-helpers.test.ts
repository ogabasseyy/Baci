import { supabase } from '@/lib/supabase';
import { HttpError } from './fetch-with-timeout';
import { MOBILE_TO_KUDA_PROVIDER } from './network-utils';
import {
  creditedVtuCashback,
  getAccessToken,
  normalizeConfirmCheckoutStatus,
  normalizeVtuCheckoutPayload,
  shouldRotateWalletIdempotencyKeyForError,
} from './vtu-checkout-helpers';

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(),
      getUser: jest.fn(),
    },
  },
}));

const mockGetUser = supabase.auth.getUser as jest.Mock;
const mockGetSession = supabase.auth.getSession as jest.Mock;

describe('vtu checkout helpers', () => {
  it('normalizes legacy provider casing and checkout statuses', () => {
    expect(
      normalizeVtuCheckoutPayload({ amount: 1000, networkProvider: 'MTN' })
    ).toMatchObject({ networkProvider: MOBILE_TO_KUDA_PROVIDER.mtn });
    expect(normalizeConfirmCheckoutStatus('already_completed')).toBe(
      'processing'
    );
  });

  it('rotates keys only for 4xx errors', () => {
    expect(
      shouldRotateWalletIdempotencyKeyForError(new HttpError(400, 'bad'))
    ).toBe(true);
    expect(
      shouldRotateWalletIdempotencyKeyForError(new HttpError(500, 'bad'))
    ).toBe(false);
  });

  it('keeps the key for pre-route and timeout statuses', () => {
    // Codex R95 P1: 408/425 can arrive after the handler accepted the
    // request or committed the debit — rotating would mint a fresh
    // UUID and debit a second transaction (mirrors web).
    for (const status of [401, 403, 408, 413, 415, 425, 429]) {
      expect(
        shouldRotateWalletIdempotencyKeyForError(new HttpError(status, 'x'))
      ).toBe(false);
    }
  });

  it('times out a stalled auth call instead of hanging the checkout guard', async () => {
    // Codex R96 P2: callers create their POST deadline only after the
    // token resolves, so an unbounded stall bricked every utility
    // purchase until restart. The timeout error releases the guard
    // via the handler finally.
    jest.useFakeTimers();
    try {
      mockGetUser.mockImplementation(() => new Promise(() => {}));
      const pending = getAccessToken('user-1', {
        requireSubmitterBinding: true,
      });
      const assertion = expect(pending).rejects.toThrow(
        'Authentication timed out. Please try again.'
      );
      await jest.advanceTimersByTimeAsync(30_000);
      await assertion;
    } finally {
      jest.useRealTimers();
      mockGetUser.mockReset();
      mockGetSession.mockReset();
    }
  });

  it('surfaces cashback only when the server credited it', () => {
    const credited = { amount: 50, credited: true, newBalance: 1200 };
    expect(creditedVtuCashback(credited)).toBe(credited);
    // RPC failure still returns a success with credited:false + zero
    // balance — never show that as received cashback.
    expect(
      creditedVtuCashback({ amount: 50, credited: false, newBalance: 0 })
    ).toBeUndefined();
    expect(creditedVtuCashback(undefined)).toBeUndefined();
    expect(creditedVtuCashback(null)).toBeUndefined();
  });
});
