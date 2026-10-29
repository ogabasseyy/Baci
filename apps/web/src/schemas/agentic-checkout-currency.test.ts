import { describe, expect, it } from 'vitest';
import { checkoutSessionSchema } from '@/schemas/agentic-checkout';

describe('checkoutSessionSchema currency defaults', () => {
  it('defaults an item checkout to NGN when currency is omitted', () => {
    const result = checkoutSessionSchema.safeParse({
      items: [{ id: 'product-1', quantity: 2 }],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toMatchObject({
        currency: 'NGN',
        items: [{ id: 'product-1', quantity: 2 }],
      });
    }
  });
});
