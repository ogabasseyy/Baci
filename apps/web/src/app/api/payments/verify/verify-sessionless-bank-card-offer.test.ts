import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, expect, it, vi } from 'vitest';
import { createStorefrontOrderRpcClient } from '@/lib/checkout/storefront-order-rpc-client';
import { verifyBankCardOfferPaystack } from '@/lib/checkout/verify-bank-card-offer-paystack';
import { bankCardOfferContextFixture } from '@/schemas/bank-card-offer-payment-context.test-support';
import type { GuestPaymentReferenceSnapshot } from './guest-payment-reference-snapshot';
import { verifySessionlessBankCardOffer } from './verify-sessionless-bank-card-offer';

vi.mock('@/lib/checkout/storefront-order-rpc-client', () => ({
  createStorefrontOrderRpcClient: vi.fn(),
}));
vi.mock('@/lib/checkout/verify-bank-card-offer-paystack', () => ({
  verifyBankCardOfferPaystack: vi.fn(),
}));

const verify = vi.mocked(verifyBankCardOfferPaystack);
const verifyNative = (
  snapshot: GuestPaymentReferenceSnapshot,
  client: SupabaseClient
) =>
  verifySessionlessBankCardOffer(
    snapshot,
    client,
    createStorefrontOrderRpcClient
  );
const rpc = vi.fn();
const buyerRpc = vi.fn();
const buyerClient = { rpc: buyerRpc } as unknown as SupabaseClient;
const reference = `BCO-${'a'.repeat(32)}`;
const saved = {
  ...bankCardOfferContextFixture,
  reference,
  domain: 'test',
  acceptedFilterPolicyHash: 'a'.repeat(64),
};
const snapshot: GuestPaymentReferenceSnapshot = {
  orderId: 'order-1',
  transactionId: 'transaction-1',
  merchantId: saved.quote.merchantId,
  orderNumber: 'ORD-1',
  amount: 95,
  currency: 'NGN',
  transactionStatus: 'pending',
  gateway: 'paystack',
  gatewayReference: reference,
  orderPaymentStatus: 'pending',
  orderShippingStatus: 'pending',
  orderTotal: 95,
  inventoryConfirmed: false,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(createStorefrontOrderRpcClient).mockReturnValue({
    rpc,
  } as unknown as SupabaseClient);
  rpc.mockResolvedValueOnce({ data: saved, error: null });
  buyerRpc.mockResolvedValue({ data: true, error: null });
});

it.each([
  'failed',
  'cancelled',
  'abandoned',
  'reversed',
] as const)('records a %s attempt before responding, without settling it', async (status) => {
  verify.mockResolvedValueOnce({ kind: 'terminal', status });
  rpc.mockResolvedValueOnce({ data: true, error: null });

  const result = await verifyNative(snapshot, buyerClient);

  expect(result.status).toBe(200);
  await expect(result.json()).resolves.toEqual({
    success: false,
    status,
    orderId: snapshot.orderId,
    orderNumber: 'ORD-1',
  });
  expect(rpc).toHaveBeenLastCalledWith('flag_bank_card_offer_terminal_review', {
    p_order_id: snapshot.orderId,
    p_merchant_id: snapshot.merchantId,
    p_transaction_id: snapshot.transactionId,
    p_status: status,
  });
  expect(rpc).toHaveBeenCalledTimes(2);
  expect(buyerRpc).not.toHaveBeenCalled();
});

it('returns a retryable error when the terminal review is unavailable', async () => {
  verify.mockResolvedValueOnce({ kind: 'terminal', status: 'failed' });
  rpc.mockResolvedValueOnce({ data: false, error: null });

  const result = await verifyNative(snapshot, buyerClient);

  expect(result.status).toBe(503);
  await expect(result.json()).resolves.toEqual({
    error: 'Verification unavailable',
  });
});

it('rejects saved context with a different reference before contacting Paystack', async () => {
  rpc.mockReset().mockResolvedValue({
    data: { ...saved, reference: `BCO-${'b'.repeat(32)}` },
  });

  const result = await verifyNative(snapshot, buyerClient);

  expect(result.status).toBe(202);
  expect(verify).not.toHaveBeenCalled();
});

it('rejects another gateway without consulting the verification context', async () => {
  const result = await verifyNative(
    { ...snapshot, gateway: 'korapay' },
    buyerClient
  );

  expect(result.status).toBe(400);
  expect(rpc).not.toHaveBeenCalled();
});

it('keeps the verified capture pending and flags it for reconciliation without settling it', async () => {
  verify.mockResolvedValueOnce({ kind: 'verified' } as never);

  const result = await verifyNative(snapshot, buyerClient);

  expect(result.status).toBe(202);
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(buyerRpc).toHaveBeenCalledExactlyOnceWith(
    'ensure_bank_card_offer_capture_sweep',
    { p_reference: reference }
  );
});

it('reports a verified payment that already settled with confirmed inventory', async () => {
  verify.mockResolvedValueOnce({ kind: 'verified' } as never);

  const result = await verifyNative(
    {
      ...snapshot,
      transactionStatus: 'completed',
      orderPaymentStatus: 'paid',
      inventoryConfirmed: true,
    },
    buyerClient
  );

  await expect(result.json()).resolves.toMatchObject({
    success: true,
    status: 'success',
    finalizationOutcome: 'completed',
  });
  expect(verify).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ reference })
  );
  expect(buyerRpc).not.toHaveBeenCalled();
});

it('rechecks settled attempts for reversals before reporting history success', async () => {
  verify.mockResolvedValueOnce({ kind: 'terminal', status: 'reversed' });
  rpc.mockResolvedValueOnce({ data: true, error: null });
  const result = await verifyNative(
    {
      ...snapshot,
      transactionStatus: 'completed',
      orderPaymentStatus: 'paid',
      inventoryConfirmed: true,
    },
    buyerClient
  );
  expect(verify).toHaveBeenCalledOnce();
  await expect(result.json()).resolves.toMatchObject({
    success: false,
    status: 'reversed',
  });
});

it('records a capture mismatch without authorizing settlement', async () => {
  verify.mockResolvedValueOnce({ kind: 'mismatch' });
  rpc.mockResolvedValueOnce({ data: true, error: null });

  const result = await verifyNative(snapshot, buyerClient);

  expect(result.status).toBe(202);
  await expect(result.json()).resolves.toMatchObject({
    code: 'BANK_CARD_OFFER_CAPTURE_REVIEW',
    orderNumber: 'ORD-1',
    status: 'pending',
  });
  expect(rpc).toHaveBeenLastCalledWith('flag_bank_card_offer_capture_review', {
    p_order_id: snapshot.orderId,
    p_merchant_id: snapshot.merchantId,
    p_transaction_id: snapshot.transactionId,
  });
  expect(rpc).toHaveBeenCalledTimes(2);
  expect(buyerRpc).not.toHaveBeenCalled();
});

it('keeps a pending provider transaction out of capture review', async () => {
  verify.mockResolvedValueOnce({ kind: 'pending' });

  const result = await verifyNative(snapshot, buyerClient);

  expect(result.status).toBe(202);
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(buyerRpc).not.toHaveBeenCalled();
});

it('returns a retryable failure when a capture mismatch could not be recorded', async () => {
  verify.mockResolvedValueOnce({ kind: 'mismatch' });
  rpc.mockResolvedValueOnce({ data: null, error: { code: 'unavailable' } });
  const result = await verifyNative(snapshot, buyerClient);
  expect(result.status).toBe(503);
  expect(buyerRpc).not.toHaveBeenCalled();
});

it.each([
  { data: false, error: null },
  { data: null, error: { code: '57014' } },
])('responds with a retryable error if capture recovery is not durable (%j)', async (outcome) => {
  verify.mockResolvedValueOnce({ kind: 'verified' } as never);
  buyerRpc.mockResolvedValueOnce(outcome);

  expect((await verifyNative(snapshot, buyerClient)).status).toBe(503);
  expect(buyerRpc).toHaveBeenCalledExactlyOnceWith(
    'ensure_bank_card_offer_capture_sweep',
    { p_reference: reference }
  );
});

it('backs off on a Paystack outage without filing a capture review', async () => {
  verify.mockResolvedValueOnce({ kind: 'unavailable' });
  const result = await verifyNative(snapshot, buyerClient);
  expect(result.status).toBe(503);
  expect(result.headers.get('Retry-After')).toBe('15');
  expect(rpc).toHaveBeenCalledOnce();
  expect(buyerRpc).not.toHaveBeenCalled();
});
