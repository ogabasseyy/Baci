import { describe, expect, it } from 'vitest';
import { chatwootProductCardSchema } from './chatwoot-product-card';

describe('Chatwoot product card schema', () => {
  const card = {
    availability: 'in_stock',
    currency: 'NGN',
    name: 'Phone',
    price: 10,
    slug: 'phone',
    variants: [
      {
        attributes: { storage: '128GB' },
        availability: 'in_stock',
        id: '00000000-0000-0000-0000-000000000001',
        price: 10,
      },
    ],
  };

  it('accepts PostgreSQL UUIDs without imposing RFC version or variant bits', () => {
    expect(chatwootProductCardSchema.safeParse(card).success).toBe(true);
  });

  it('rejects malformed UUIDs and string prices', () => {
    expect(
      chatwootProductCardSchema.safeParse({
        ...card,
        price: '10',
      }).success
    ).toBe(false);
    expect(
      chatwootProductCardSchema.safeParse({
        ...card,
        variants: [{ ...card.variants[0], id: 'not-a-uuid' }],
      }).success
    ).toBe(false);
  });
});
