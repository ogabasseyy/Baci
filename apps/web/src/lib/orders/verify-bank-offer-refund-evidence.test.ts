import { beforeEach, expect, it, vi } from 'vitest';
import { verifyTransaction } from '@/lib/paystack';
import { verifyBankOfferRefundEvidence } from './verify-bank-offer-refund-evidence';

vi.mock('@/lib/paystack', () => ({ verifyTransaction: vi.fn() }));

const identity = {
  p_order_id: 'order-1',
  p_merchant_id: 'merchant-1',
  p_transaction_id: 'transaction-1',
  p_reference: `BCO-${'a'.repeat(32)}`,
};
const capture = {
  status: 'success',
  reference: identity.p_reference,
  currency: 'NGN',
  amount: 9501,
  id: '9007199254740993',
  domain: 'test',
};
const rpc = vi.fn();
const input = { claimToken: 'claim-1', identity, supabase: { rpc } };

beforeEach(() => {
  vi.resetAllMocks();
  rpc.mockResolvedValue({ data: '9501', error: null });
  vi.mocked(verifyTransaction).mockResolvedValue({
    success: true,
    data: capture,
  } as never);
});

it('binds the original Paystack ID and verified kobo amount to the scoped claim', async () => {
  await expect(verifyBankOfferRefundEvidence(input)).resolves.toEqual({
    kind: 'verified',
    evidence: {
      ...identity,
      p_claim_token: 'claim-1',
      p_provider_id: capture.id,
      p_provider_domain: 'test',
      p_amount_kobo: 9501,
    },
  });
  expect(rpc).toHaveBeenCalledWith(
    'get_bank_card_offer_refundable_amount',
    identity
  );
  expect(verifyTransaction).toHaveBeenCalledWith(
    identity.p_reference,
    expect.any(AbortSignal),
    { textIds: true }
  );
});

it.each([
  [{ data: null, error: { code: '57014' } }, 'unavailable'],
  [{ data: '0', error: null }, 'mismatch'],
])('stops before the provider lookup when the saved capture is %j', async (row, kind) => {
  rpc.mockResolvedValueOnce(row);
  await expect(verifyBankOfferRefundEvidence(input)).resolves.toEqual({ kind });
  expect(verifyTransaction).not.toHaveBeenCalled();
});

it('preserves a retryable outcome on provider lookup failure', async () => {
  vi.mocked(verifyTransaction).mockResolvedValueOnce({
    success: false,
    error: 'Lookup unavailable',
  });
  await expect(verifyBankOfferRefundEvidence(input)).resolves.toEqual({
    kind: 'unavailable',
  });
});

it.each([
  { amount: 9500 },
  { reference: 'other-reference' },
  { id: 55 },
  { domain: 'unknown' },
  { currency: 'USD' },
  { status: 'reversed' },
])('rejects mismatched provider evidence %j', async (override) => {
  vi.mocked(verifyTransaction).mockResolvedValueOnce({
    data: { ...capture, ...override },
    success: true,
  } as never);
  await expect(verifyBankOfferRefundEvidence(input)).resolves.toEqual({
    kind: 'mismatch',
  });
});

it('keeps the capture lookup but skips Paystack after the verification deadline', async () => {
  await expect(
    verifyBankOfferRefundEvidence({ ...input, verifyDeadlineMs: Date.now() })
  ).resolves.toEqual({ kind: 'deadline' });
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(verifyTransaction).not.toHaveBeenCalled();
});
