import { expect, it } from 'vitest';
import {
  buyerClient,
  buyerRpc,
  reference,
  rpc,
  snapshot,
  verify,
  verifyNative,
} from './verify-sessionless-bank-card-offer.test-support';

it('reports a verified payment that already settled with confirmed inventory', async () => {
  verify.mockResolvedValueOnce({ kind: 'verified' } as never);
  rpc.mockResolvedValueOnce({ data: false, error: null });

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

it.each([
  { payment: 'pending', shipping: 'cancelled', outcome: 'order_cancelled' },
  { payment: 'canceled', shipping: 'pending', outcome: 'order_cancelled' },
  { payment: 'refunded', shipping: 'pending', outcome: 'order_skipped' },
] as const)('reports a verified terminal order as $outcome', async ({
  payment,
  shipping,
  outcome,
}) => {
  verify.mockResolvedValueOnce({ kind: 'verified' } as never);

  const response = await verifyNative(
    {
      ...snapshot,
      transactionStatus: 'completed',
      orderPaymentStatus: payment,
      orderShippingStatus: shipping,
    },
    buyerClient
  );

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    orderId: snapshot.orderId,
    success: true,
    status: 'success',
    finalizationOutcome: outcome,
  });
  expect(buyerRpc).not.toHaveBeenCalled();
});

it('waits for durable capture when a cancelled order still has a pending transaction', async () => {
  verify.mockResolvedValueOnce({ kind: 'verified' } as never);

  const response = await verifyNative(
    { ...snapshot, orderShippingStatus: 'cancelled' },
    buyerClient
  );

  expect(response.status).toBe(202);
  expect(buyerRpc).toHaveBeenCalledExactlyOnceWith(
    'ensure_bank_card_offer_capture_sweep',
    { p_reference: reference }
  );
});

it('rechecks settled attempts for reversals before reporting history success', async () => {
  verify.mockResolvedValueOnce({
    kind: 'terminal',
    status: 'reversed',
    reportedReversalAmountKobo: 875,
  });
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
    reference,
  });
  expect(rpc).toHaveBeenLastCalledWith(
    'flag_bank_card_offer_terminal_review',
    expect.objectContaining({
      p_status: 'reversed',
      p_reported_amount_kobo: 875,
    })
  );
});

it.each([
  { data: true, error: null, status: 202 },
  { data: null, error: null, status: 503 },
  { data: null, error: { code: '57014' }, status: 503 },
])('withholds native settlement for a durable hold or unavailable check (%j)', async ({
  data,
  error,
  status,
}) => {
  verify.mockResolvedValueOnce({ kind: 'verified' } as never);
  rpc.mockResolvedValueOnce({ data, error });
  const result = await verifyNative(
    {
      ...snapshot,
      transactionStatus: 'completed',
      orderPaymentStatus: 'paid',
      inventoryConfirmed: true,
    },
    buyerClient
  );

  expect(result.status).toBe(status);
  expect(await result.json()).not.toHaveProperty('finalizationOutcome');
  if (data === true) {
    expect(rpc).toHaveBeenLastCalledWith(
      'get_bank_card_offer_verification_hold',
      {
        p_order_id: snapshot.orderId,
        p_merchant_id: snapshot.merchantId,
        p_transaction_id: snapshot.transactionId,
      }
    );
  }
  expect(buyerRpc).not.toHaveBeenCalled();
});
