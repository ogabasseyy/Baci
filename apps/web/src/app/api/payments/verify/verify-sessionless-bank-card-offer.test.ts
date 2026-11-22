import { expect, it } from 'vitest';
import {
  buyerClient,
  buyerRpc,
  reference,
  rpc,
  saved,
  snapshot,
  verify,
  verifyNative,
} from './verify-sessionless-bank-card-offer.test-support';

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
    ...(status === 'reversed' ? { reference } : {}),
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
