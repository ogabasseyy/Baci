import { expect, it, vi } from 'vitest';
import { verifyBankCardOfferPaystack } from '@/lib/checkout/verify-bank-card-offer-paystack';
import { bankCardOfferContextFixture } from '@/schemas/bank-card-offer-payment-context.test-support';
import { approveBankCardOfferPayment } from './approve-bank-card-offer-payment';

vi.mock('@/lib/checkout/verify-bank-card-offer-paystack', () => ({
  verifyBankCardOfferPaystack: vi.fn(),
}));

const merchantId = bankCardOfferContextFixture.quote.merchantId;
const reference = `BCO-${'a'.repeat(32)}`;
const context = {
  ...bankCardOfferContextFixture,
  reference,
  domain: 'test',
  acceptedFilterPolicyHash: 'b'.repeat(64),
};
const input = {
  merchantId,
  reference,
  orderId: 'order',
  transactionId: 'transaction',
};

it('rejects context for another reference before verifying with Paystack', async () => {
  vi.clearAllMocks();
  const rpc = vi.fn().mockResolvedValue({
    data: { ...context, reference: `BCO-${'c'.repeat(32)}` },
  });
  await expect(
    approveBankCardOfferPayment({ ...input, client: { rpc } })
  ).resolves.toBeNull();
  expect(verifyBankCardOfferPaystack).not.toHaveBeenCalled();
});

it.each([
  { verification: null, label: 'verification is unavailable' },
  {
    verification: { kind: 'terminal', status: 'reversed' } as const,
    label: 'Paystack confirms a reversal',
  },
])('does not replay saved approval when $label', async ({ verification }) => {
  vi.clearAllMocks();
  vi.mocked(verifyBankCardOfferPaystack).mockResolvedValueOnce(verification);
  const rpc = vi.fn().mockResolvedValue({
    data: { ...context, completedGatewayResponse: { status: 'success' } },
  });

  await expect(
    approveBankCardOfferPayment({ ...input, client: { rpc } })
  ).resolves.toEqual(verification);

  expect(verifyBankCardOfferPaystack).toHaveBeenCalledTimes(1);
  expect(rpc).toHaveBeenCalledTimes(1);
});

it('withholds settlement when the verified capture fails to save', async () => {
  const gatewayResponse = { status: 'success' };
  const evidence = { reference };
  vi.mocked(verifyBankCardOfferPaystack).mockResolvedValue({
    kind: 'verified',
    evidence,
    gatewayResponse,
  } as never);
  const rpc = vi
    .fn()
    .mockResolvedValueOnce({ data: context })
    .mockResolvedValueOnce({ data: false });
  await expect(
    approveBankCardOfferPayment({ ...input, client: { rpc } })
  ).resolves.toBeNull();
  expect(rpc).toHaveBeenLastCalledWith(
    'approve_bank_card_offer_capture',
    expect.objectContaining({
      p_evidence: evidence,
      p_gateway_response: gatewayResponse,
    })
  );
});

it('does not approve a capture if the reversal-only recheck sees success', async () => {
  const signal = new AbortController().signal;
  vi.mocked(verifyBankCardOfferPaystack).mockResolvedValueOnce({
    kind: 'verified',
    evidence: { reference },
    gatewayResponse: { status: 'success' },
  } as never);
  const rpc = vi.fn().mockResolvedValue({ data: context });

  await expect(
    approveBankCardOfferPayment({
      ...input,
      client: { rpc },
      reversalOnly: true,
      signal,
    })
  ).resolves.toBeNull();

  expect(verifyBankCardOfferPaystack).toHaveBeenLastCalledWith(
    expect.objectContaining({ reference }),
    signal
  );
  expect(rpc).toHaveBeenCalledTimes(1);
});
