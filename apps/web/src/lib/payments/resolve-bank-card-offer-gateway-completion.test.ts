import { beforeEach, expect, it, vi } from 'vitest';
import { approveBankCardOfferPayment } from './approve-bank-card-offer-payment';
import { completeOrderGatewayPayment } from './complete-order-gateway-payment';
import { resolveBankCardOfferGatewayCompletion } from './resolve-bank-card-offer-gateway-completion';

vi.mock('./approve-bank-card-offer-payment', () => ({
  approveBankCardOfferPayment: vi.fn(),
}));
vi.mock('./complete-order-gateway-payment', () => ({
  completeOrderGatewayPayment: vi.fn(),
}));

const approve = vi.mocked(approveBankCardOfferPayment);
const complete = vi.mocked(completeOrderGatewayPayment);
const rpc = vi.fn();
const insert = vi.fn();
const scopedClient = { rpc } as never;
const supabase = { from: vi.fn(() => ({ insert })) } as never;
const input = {
  actor: 'unit-test',
  gateway: 'paystack' as const,
  merchantId: 'merchant-1',
  orderId: 'order-1',
  reference: `BCO-${'a'.repeat(32)}`,
  scopedClient,
  supabase,
  transactionId: 'tx-1',
};

beforeEach(() => vi.resetAllMocks());

it.each([
  'pending',
  'unavailable',
] as const)('waits on a %s payment without completing it', async (kind) => {
  approve.mockResolvedValue({ kind });
  await expect(resolveBankCardOfferGatewayCompletion(input)).resolves.toEqual({
    ok: false,
    outcome: {
      kind: 'bank_offer_verification_wait',
      providerUnavailable: kind === 'unavailable',
    },
  });
  expect(complete).not.toHaveBeenCalled();
});

it.each([
  true,
  false,
])('requires durable reversal review (%s)', async (saved) => {
  approve.mockResolvedValue({
    kind: 'terminal',
    status: 'reversed',
    reportedReversalAmountKobo: 100,
  });
  rpc.mockResolvedValue({ data: saved, error: null });
  const result = await resolveBankCardOfferGatewayCompletion(input);
  expect(rpc).toHaveBeenCalledExactlyOnceWith(
    'flag_bank_card_offer_terminal_review',
    {
      p_order_id: input.orderId,
      p_merchant_id: input.merchantId,
      p_transaction_id: input.transactionId,
      p_status: 'reversed',
      p_reported_amount_kobo: 100,
    }
  );
  expect(result).toMatchObject({
    ok: false,
    outcome: { kind: saved ? 'bank_offer_terminal' : 'completion_failed' },
  });
  expect(complete).not.toHaveBeenCalled();
});

it.each([
  [null, 'bank_offer_capture_review'],
  [{ code: '23505' }, 'bank_offer_capture_review'],
  [{ code: '57014' }, 'completion_failed'],
])('handles capture mismatch review write %j', async (error, kind) => {
  approve.mockResolvedValue({ kind: 'mismatch' });
  insert.mockResolvedValue({ error });
  await expect(
    resolveBankCardOfferGatewayCompletion(input)
  ).resolves.toMatchObject({
    ok: false,
    outcome: { kind },
  });
  expect(insert).toHaveBeenCalledWith(
    expect.objectContaining({
      merchant_id: input.merchantId,
      txn_id: input.transactionId,
      paystack_ref: input.reference,
    })
  );
  expect(complete).not.toHaveBeenCalled();
});

it.each([
  { data: false, error: null, outcome: undefined },
  { data: true, error: null, outcome: 'bank_offer_capture_review' },
  {
    data: null,
    error: { code: '57014' },
    outcome: 'bank_offer_verification_wait',
  },
])('requires an unheld capture before completing (%j)', async ({
  data,
  error,
  outcome,
}) => {
  const gatewayResponse = {
    id: '55',
    status: 'success' as const,
    reference: input.reference,
    amount: 9500,
    currency: 'NGN',
    channel: 'card',
    paid_at: '2026-11-21T12:00:00Z',
    created_at: '2026-11-21T11:59:00Z',
    customer: {
      id: 1,
      email: 'buyer@example.test',
      customer_code: 'customer-1',
      first_name: null,
      last_name: null,
      phone: null,
    },
    metadata: null,
    fees: 100,
    fees_split: null,
  };
  approve.mockResolvedValue({
    kind: 'verified',
    gatewayResponse,
    evidence: {
      acceptedFilterPolicyHash: 'a'.repeat(64),
      amountKobo: gatewayResponse.amount,
      cardBrand: 'visa',
      cardChannel: 'card',
      contractVersion: 'paystack_verified_card_v1',
      currency: gatewayResponse.currency,
      customerEmail: gatewayResponse.customer.email,
      domain: 'test',
      issuerName: 'Wema Bank',
      providerVerificationId: gatewayResponse.id,
      reference: input.reference,
      verificationSource: 'paystack_transaction_verify',
      verifiedAt: gatewayResponse.paid_at,
    },
  });
  rpc.mockResolvedValueOnce({ data, error });
  if (outcome) {
    await expect(
      resolveBankCardOfferGatewayCompletion(input)
    ).resolves.toMatchObject({
      ok: false,
      outcome: {
        kind: outcome,
        ...(data === true ? { temporaryHold: true } : {}),
      },
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      'get_bank_card_offer_verification_hold',
      {
        p_order_id: input.orderId,
        p_merchant_id: input.merchantId,
        p_transaction_id: input.transactionId,
      }
    );
    expect(complete).not.toHaveBeenCalled();
    return;
  }
  complete.mockResolvedValue({
    ok: true,
    completion: {
      actor: input.actor,
      already_completed: false,
      cancelled_at: null,
      order_already_paid: false,
      order_cancelled: false,
      order_number: 'OG-1',
      order_skipped_status: null,
      order_updated: true,
      payment_status: 'paid',
      previous_payment_status: 'pending',
      previous_shipping_status: 'pending',
      shipping_status: 'pending',
    },
  });
  await expect(
    resolveBankCardOfferGatewayCompletion(input)
  ).resolves.toMatchObject({
    ok: true,
    atomicTransactionFlip: true,
    verifiedGatewayResponse: gatewayResponse,
  });
  expect(complete).toHaveBeenCalledWith(
    expect.objectContaining({
      gatewayResponse,
      merchantId: input.merchantId,
      orderId: input.orderId,
      transactionId: input.transactionId,
      supabase,
    })
  );
});
