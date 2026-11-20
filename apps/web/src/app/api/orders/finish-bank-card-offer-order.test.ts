import { expect, it, vi } from 'vitest';
import type { BankCardOffer } from '@/schemas/bank-card-offer';
import { finishBankCardOfferOrder } from './finish-bank-card-offer-order';

it('rejects a fractional fee before writing an order or running post-commit work', async () => {
  const rpc = vi.fn();
  const repairEffects = vi.fn();
  const response = await finishBankCardOfferOrder({
    offer: {} as BankCardOffer,
    userId: 'session-user',
    requestHash: 'fixture',
    client: { rpc },
    orderArgs: {},
    items: [],
    fees: [0.005],
    currency: 'NGN',
    expectedTotal: 95,
    hasIncompatibleDiscount: false,
    merchantId: 'merchant',
    merchantSlug: 'ogabassey',
    repairEffects,
  });
  expect(response.status).toBe(409);
  await expect(response.json()).resolves.toMatchObject({
    code: 'BANK_CARD_OFFER_AMOUNT_INVALID',
  });
  expect(rpc).not.toHaveBeenCalled();
  expect(repairEffects).not.toHaveBeenCalled();
});
