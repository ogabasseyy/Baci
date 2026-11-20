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

it('replays a saved approval without contacting Paystack', async () => {
  vi.clearAllMocks();
  const gatewayResponse = { status: 'success' };
  const rpc = vi.fn().mockResolvedValue({
    data: { ...context, completedGatewayResponse: gatewayResponse },
  });
  await expect(
    approveBankCardOfferPayment({ ...input, client: { rpc } })
  ).resolves.toEqual({ kind: 'verified', gatewayResponse });
  expect(verifyBankCardOfferPaystack).not.toHaveBeenCalled();
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
