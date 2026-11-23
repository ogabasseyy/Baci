import { describe, expect, it, vi } from 'vitest';
import {
  merchantId,
  orderId,
  reference,
  request,
  secret,
  setup,
} from './bank-card-offer-flow.test-support';
import { mocks } from './bank-card-offer-flow-mocks.test-support';
import { POST as webhook } from './webhook/route';

describe('bank card offer webhook', () => {
  it.each([
    { error: null, status: 200 },
    { error: { code: '57014' }, status: 503 },
  ])('distinguishes a missing signed capture from a lookup outage ($status)', async ({
    error,
    status,
  }) => {
    vi.stubEnv('PAYSTACK_SECRET_KEY', secret);
    const { refundInsert } = setup('035', 'Wema Bank', { data: null, error });
    const response = await webhook(
      request(
        'webhook',
        {
          event: 'charge.success',
          data: {
            reference,
            metadata: { merchant_id: merchantId, order_id: orderId },
          },
        },
        true
      )
    );
    expect(response.status).toBe(status);
    if (error) {
      expect(refundInsert).not.toHaveBeenCalled();
    } else {
      await expect(response.json()).resolves.toMatchObject({
        code: 'PAYSTACK_PAYMENT_MATCH_ZERO_CANDIDATES',
      });
      expect(refundInsert).toHaveBeenCalledWith({
        issue_type: 'payment_match_zero_candidates',
        paystack_ref: reference,
        reason:
          'Signed bank-offer charge webhook did not match a saved payment attempt',
        metadata: { source: 'bank_card_offer_webhook' },
      });
    }
    expect(mocks.verify).not.toHaveBeenCalled();
  });
});
