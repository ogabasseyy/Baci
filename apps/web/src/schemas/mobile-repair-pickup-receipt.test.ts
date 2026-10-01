import { describe, expect, it } from 'vitest';
import { mobileRepairPickupReceiptSchema } from './mobile-repair-pickup-receipt';

describe('payment receipt', () => {
  it('accepts pending and definitive failure results', () => {
    expect(
      mobileRepairPickupReceiptSchema.safeParse({ state: 'pending' }).success
    ).toBe(true);
    expect(
      mobileRepairPickupReceiptSchema.safeParse({
        state: 'complete',
        result: { success: false, code: 'quote_changed', error: 'Changed' },
      }).success
    ).toBe(true);
  });
  it('rejects an incomplete success response', () => {
    expect(
      mobileRepairPickupReceiptSchema.safeParse({
        state: 'complete',
        result: { success: true },
      }).success
    ).toBe(false);
  });
});
