import { expect, it } from 'vitest';
import {
  legacyMcpBridgeRequestSchema,
  legacyOwnerContextSchema,
} from './cart-legacy-bridge';

const productId = '11111111-1111-4111-8111-111111111111';
it('accepts read and bounded absolute edits', () => {
  expect(legacyMcpBridgeRequestSchema.safeParse({}).success).toBe(true);
  expect(
    legacyMcpBridgeRequestSchema.safeParse({
      productId,
      quantity: 0,
      expectedVersion: 1,
      operationId: 'op',
    }).success
  ).toBe(true);
});
it.each([
  { productId },
  { quantity: 1 },
  { productId: 'bad', quantity: 1 },
  { productId, quantity: 11 },
  { expectedVersion: 0 },
  { operationId: '' },
])('rejects invalid bridge input %j', (value) => {
  expect(legacyMcpBridgeRequestSchema.safeParse(value).success).toBe(false);
});
it('rejects malformed recovered owner authority', () => {
  expect(
    legacyOwnerContextSchema.safeParse({ ok: true, cartId: 'bad' }).success
  ).toBe(false);
  expect(
    legacyOwnerContextSchema.safeParse({
      ok: true,
      grantId: productId,
      cartId: productId,
      grantExpiresAt: '2099-01-01T00:00:00Z',
    }).success
  ).toBe(true);
});
