import { expect } from 'vitest';
import { POST as submit } from './orders/route';
import {
  expectJson,
  request,
  verifyConcurrentRetry,
} from './partner-lifecycle-db.test-support';

export async function verifyPartnerIntake(
  orderToken: string,
  orderPayload: { payment: { amount_minor: number } }
) {
  const purchase = (amount_minor = orderPayload.payment.amount_minor) =>
    submit(
      request(
        'partners/v1/orders',
        orderToken,
        { ...orderPayload, payment: { ...orderPayload.payment, amount_minor } },
        { 'Idempotency-Key': 'fixture-order-idempotency-0001' }
      )
    );

  const rejected = await expectJson(
    await purchase(orderPayload.payment.amount_minor + 1),
    409,
    'POST /orders'
  );
  expect(rejected.error).toEqual({ code: 'ORDER_AMOUNT_MISMATCH' });
  // Use the same quote, order reference and key. The bad amount must not claim any of them.
  const pending = await verifyConcurrentRetry(purchase, 202, 'POST /orders');
  return { pending, purchase };
}
