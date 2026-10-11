import { HttpError } from './fetch-with-timeout';
import { MOBILE_TO_KUDA_PROVIDER } from './network-utils';
import {
  creditedVtuCashback,
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
