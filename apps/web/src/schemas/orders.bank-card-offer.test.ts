import { describe, expect, it } from 'vitest';
import { orderCreateSchema } from './orders';
import { validOrder } from './orders.test-support';

describe('bank-card-offer order schema', () => {
  it('rejects a bank card offer ID attached to a standard payment', () => {
    const result = orderCreateSchema.safeParse({
      ...validOrder,
      bank_card_offer_id: 'black-friday',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['bank_card_offer_id']);
    }
  });

  it('requires an offer ID when bank-card-offer payment is selected', () => {
    expect(
      orderCreateSchema.safeParse({
        ...validOrder,
        payment_method: 'bank_card_offer',
      }).error?.issues[0]?.path
    ).toEqual(['bank_card_offer_id']);
    expect(
      orderCreateSchema.safeParse({
        ...validOrder,
        payment_method: 'bank_card_offer',
        bank_card_offer_id: 'black-friday',
      }).success
    ).toBe(true);
  });
});
