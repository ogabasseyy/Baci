import { expect, it, vi } from 'vitest';
import { beginBankCardOfferRefundDispatch } from './begin-bank-card-offer-refund-dispatch';
import {
  initiationOrder,
  initiationTransaction,
} from './initiate-paystack-cancellation-refunds.test-helpers';

it('cannot dispatch a refund when the admission database write fails', async () => {
  const rpc = vi.fn().mockResolvedValue({ error: { code: '08006' } });
  await expect(
    beginBankCardOfferRefundDispatch({
      evidence: {
        p_order_id: initiationOrder.id,
        p_merchant_id: initiationOrder.merchant_id,
        p_transaction_id: initiationTransaction.id,
        p_reference: 'fixture',
        p_claim_token: 'claim',
        p_provider_id: '1',
        p_provider_domain: 'test',
        p_amount_kobo: 1000,
      },
      order: initiationOrder,
      refundIds: [],
      supabase: { rpc } as never,
      transaction: initiationTransaction,
    })
  ).resolves.toBe('unavailable');
});
