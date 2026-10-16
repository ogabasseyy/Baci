import { pendingCartBodySchema } from './cart-pending-request';

describe('pendingCartBodySchema', () => {
  it('accepts a create body and a command body', () => {
    expect(
      pendingCartBodySchema.safeParse({
        kind: 'create',
        input: { operationId: 'op-1' },
      }).success
    ).toBe(true);
    expect(
      pendingCartBodySchema.safeParse({
        kind: 'command',
        cartId: '11111111-1111-4111-8111-111111111111',
        input: {
          operationId: 'op-1',
          expectedVersion: 1,
          command: { type: 'clear' },
        },
      }).success
    ).toBe(true);
  });

  it('rejects quantities above ten and unknown kinds', () => {
    expect(
      pendingCartBodySchema.safeParse({
        kind: 'create',
        input: {
          operationId: 'op-1',
          lines: [
            {
              item: { productId: '11111111-1111-4111-8111-111111111111' },
              quantity: 11,
            },
          ],
        },
      }).success
    ).toBe(false);
    expect(
      pendingCartBodySchema.safeParse({ kind: 'transfer', input: {} }).success
    ).toBe(false);
  });

  it('requires the complete merge payload for handoff merges', () => {
    expect(
      pendingCartBodySchema.safeParse({
        kind: 'handoff',
        input: {
          token: 'ch1.abcDEF123._-xyz',
          handoffId: '11111111-1111-4111-8111-111111111111',
          attemptId: 'attempt-1',
          choice: 'merge',
        },
      }).success
    ).toBe(false);
    expect(
      pendingCartBodySchema.safeParse({
        kind: 'handoff',
        input: {
          token: 'ch1.abcDEF123._-xyz',
          handoffId: '11111111-1111-4111-8111-111111111111',
          attemptId: 'attempt-1',
          choice: 'connect',
        },
      }).success
    ).toBe(true);
  });
});
