import { describe, expect, it } from 'vitest';
import { productRequestSchema } from './product-request';

const valid = {
  query: 'iPhone 20',
  contact: 'shopper@example.com',
  merchantSlug: 'ogabassey',
  requestId: '11111111-1111-4111-8111-111111111111',
};

describe('productRequestSchema', () => {
  it('accepts a valid email request', () => {
    expect(productRequestSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts a valid phone request', () => {
    expect(
      productRequestSchema.safeParse({
        ...valid,
        contact: '+234 801 234 5678',
      }).success
    ).toBe(true);
  });

  it('rejects punctuation-only queries and bad contacts', () => {
    expect(
      productRequestSchema.safeParse({ ...valid, query: '!!!' }).success
    ).toBe(false);
    expect(
      productRequestSchema.safeParse({ ...valid, contact: '-------' }).success
    ).toBe(false);
    expect(
      productRequestSchema.safeParse({ ...valid, contact: 'a@b' }).success
    ).toBe(false);
  });

  it('rejects non-uuid request ids and bad slugs', () => {
    expect(
      productRequestSchema.safeParse({ ...valid, requestId: 'nope' }).success
    ).toBe(false);
    expect(
      productRequestSchema.safeParse({ ...valid, merchantSlug: 'Bad Slug!' })
        .success
    ).toBe(false);
  });

  it('rejects unknown keys', () => {
    expect(productRequestSchema.safeParse({ ...valid, extra: 1 }).success).toBe(
      false
    );
  });
});
