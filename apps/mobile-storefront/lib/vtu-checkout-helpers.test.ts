import { HttpError } from './fetch-with-timeout';
import { MOBILE_TO_KUDA_PROVIDER } from './network-utils';
import {
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
});
