import { expect, it } from 'vitest';
import { redvaultRecoveredOrderResponseSchema } from './redvault-recovered-order-response';

it('requires recoverable order identity while preserving the quote and order-number fallback', () => {
  const payload = {
    order: {
      id: 'order-1',
      tracking_token: 'proof',
      currency: ' ngn ',
      total: 100,
      order_number: 123,
    },
    redvault: { quote: { payable_kobo: 10000 } },
  };
  const parsed = redvaultRecoveredOrderResponseSchema.safeParse(payload);
  expect(parsed.success).toBe(true);
  if (parsed.success) {
    expect(parsed.data.order.order_number).toBeUndefined();
    expect(parsed.data.redvault).toEqual(payload.redvault);
  }
  expect(
    redvaultRecoveredOrderResponseSchema.safeParse({
      ...payload,
      order: { ...payload.order, tracking_token: '' },
    }).success
  ).toBe(false);
});
