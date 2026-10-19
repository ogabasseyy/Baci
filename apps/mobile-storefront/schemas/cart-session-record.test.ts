import { cartSessionRecordSchema } from './cart-session-record';

const proof = 'cp1.abcDEF123._-xyz';

describe('cartSessionRecordSchema', () => {
  it('accepts a session proof record', () => {
    expect(cartSessionRecordSchema.safeParse({ proof }).success).toBe(true);
  });

  it('rejects non-proof strings and malformed promotions', () => {
    expect(cartSessionRecordSchema.safeParse({ proof: 'token' }).success).toBe(
      false
    );
    expect(
      cartSessionRecordSchema.safeParse({
        proof,
        promotion: {
          kind: 'transfer',
          operationId: 'op-1',
          cartId: '11111111-1111-4111-8111-111111111111',
        },
      }).success
    ).toBe(false);
  });

  it('accepts a promotion record', () => {
    expect(
      cartSessionRecordSchema.safeParse({
        proof,
        promotion: {
          kind: 'handoff',
          operationId: 'op-1',
          cartId: '11111111-1111-4111-8111-111111111111',
        },
      }).success
    ).toBe(true);
  });
});
