import { describe, expect, it } from 'vitest';
import { chatwootCartQuantityMutationRequestSchema } from './chatwoot-cart-quantity-mutation-request';

const validQuantityMutation = {
  cartVersion: 12,
  conversationId: 905,
  expectedQuantity: 25,
  lineId: '11111111-1111-4111-8111-111111111111',
  quantity: 10,
  requestId: 'quantity-0001',
  sessionToken: 'signed-session-token',
};

describe('Chatwoot cart quantity mutation request schema', () => {
  it('permits reducing legacy lines above the UI quantity ceiling', () => {
    expect(
      chatwootCartQuantityMutationRequestSchema.safeParse(validQuantityMutation)
        .success
    ).toBe(true);
  });

  it('rejects invalid bounds, identifiers, and caller-selected fields', () => {
    for (const [field, value] of [
      ['cartVersion', 0],
      ['cartVersion', 1.5],
      ['cartVersion', Number.MAX_SAFE_INTEGER + 1],
      ['conversationId', 0],
      ['conversationId', Number.MAX_SAFE_INTEGER + 1],
      ['expectedQuantity', 0],
      ['expectedQuantity', 1001],
      ['lineId', 'line-not-uuid'],
      ['quantity', -1],
      ['quantity', 1.5],
      ['quantity', 11],
      ['requestId', 'short'],
      ['requestId', 'r'.repeat(81)],
      ['requestId', 'has spaces'],
      ['sessionToken', ''],
      ['sessionToken', 't'.repeat(12_001)],
    ] as const) {
      expect(
        chatwootCartQuantityMutationRequestSchema.safeParse({
          ...validQuantityMutation,
          [field]: value,
        }).success
      ).toBe(false);
    }
    expect(
      chatwootCartQuantityMutationRequestSchema.safeParse({
        ...validQuantityMutation,
        merchantId: 'caller-selected',
      }).success
    ).toBe(false);
  });
});
