import { expect, it } from 'vitest';
import {
  publicCommerceEvidenceIdentity,
  publicCommerceEvidenceSchemas,
} from './experience-public-commerce-evidence';

it('pins evidence to a single available item and the selected variant', () => {
  const merchantId = '11111111-1111-4111-8111-111111111111';
  const productId = '22222222-2222-4222-8222-222222222222';
  const variantId = '33333333-3333-4333-8333-333333333333';
  const identity = publicCommerceEvidenceIdentity.parse({
    merchantId,
    productId,
    variantId,
  });
  const schema = publicCommerceEvidenceSchemas(identity);
  const line = { item: { productId, variantId }, quantity: 1 };
  expect(schema.line.parse(line)).toEqual(line);
  expect(schema.line.safeParse({ ...line, item: { productId } }).success).toBe(
    false
  );
  const cart = { cartId: merchantId, merchantId, version: 1, lines: [line] };
  expect(schema.responseSchema.parse({ cart })).toEqual({ cart });
  expect(
    schema.responseSchema.safeParse({ cart: { ...cart, lines: [] } }).success
  ).toBe(false);
});
