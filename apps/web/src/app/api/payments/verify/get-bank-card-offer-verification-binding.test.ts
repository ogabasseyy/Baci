import { beforeEach, expect, it, vi } from 'vitest';
import { getAuthenticatedUser } from '@/lib/supabase/mobile-auth';
import { getBankCardOfferVerificationBinding } from './get-bank-card-offer-verification-binding';
import { getSessionlessPaymentReferenceSnapshot } from './sessionless-payment-reference-snapshot';

vi.mock('@/lib/supabase/mobile-auth', () => ({
  getAuthenticatedUser: vi.fn(),
}));
vi.mock('./sessionless-payment-reference-snapshot', () => ({
  getSessionlessPaymentReferenceSnapshot: vi.fn(),
}));

const authenticate = vi.mocked(getAuthenticatedUser);
const getSnapshot = vi.mocked(getSessionlessPaymentReferenceSnapshot);
const reference = `BCO-${'a'.repeat(32)}`;
const request = new Request('https://example.test/api/payments/verify');
const query = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  maybeSingle: vi.fn(),
};
const supabase = { from: vi.fn(() => query) };

beforeEach(() => {
  vi.clearAllMocks();
  authenticate.mockResolvedValue({ authMode: 'cookie', supabase } as never);
  getSnapshot.mockResolvedValue({
    orderId: 'order',
    merchantId: 'merchant',
  } as never);
  query.maybeSingle.mockResolvedValue({
    data: { id: 'merchant' },
    error: null,
  });
});

it('binds an owned order to the selected storefront', async () => {
  await expect(
    getBankCardOfferVerificationBinding(request, reference, 'ogabassey')
  ).resolves.toEqual({ orderId: 'order', merchantId: 'merchant' });
  expect(getSnapshot).toHaveBeenCalledWith(supabase, reference);
  expect(query.eq.mock.calls).toEqual([
    ['slug', 'ogabassey'],
    ['id', 'merchant'],
  ]);
});

it('rejects a request without a storefront or signed-in shopper', async () => {
  await expect(
    getBankCardOfferVerificationBinding(request, reference, undefined)
  ).resolves.toBeNull();
  expect(authenticate).not.toHaveBeenCalled();

  authenticate.mockResolvedValueOnce(null);
  await expect(
    getBankCardOfferVerificationBinding(request, reference, 'ogabassey')
  ).resolves.toBeNull();
  expect(getSnapshot).not.toHaveBeenCalled();
});

it('rejects an order that the session does not own', async () => {
  getSnapshot.mockResolvedValueOnce(null);

  await expect(
    getBankCardOfferVerificationBinding(request, reference, 'ogabassey')
  ).resolves.toBeNull();
  expect(supabase.from).not.toHaveBeenCalled();
});

it.each([
  { data: null, error: null },
  { data: { id: 'other-store' }, error: null },
  { data: null, error: { message: 'unavailable' } },
])('rejects mismatched or unavailable storefronts (%j)', async (result) => {
  query.maybeSingle.mockResolvedValueOnce(result);

  await expect(
    getBankCardOfferVerificationBinding(request, reference, 'wrong-store')
  ).resolves.toBeNull();
});
