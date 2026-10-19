import { describe, expect, it } from 'vitest';
import { createHandoffToken } from '@/lib/cart/handoff-token';
import { cartHandoffPairingTokenSchema } from './cart';

const input = {
  cartId: '22222222-2222-4222-8222-222222222222',
  merchantId: '11111111-1111-4111-8111-111111111111',
  operationId: '33333333-3333-4333-8333-333333333333',
  principalId: '44444444-4444-4444-8444-444444444444',
  environment: `release:${'a'.repeat(41)}`,
};
const secret = 'test-handoff-secret-min-32-chars!!!!';

describe('handoff preview token boundary', () => {
  it.each([
    'web',
    'native',
  ] as const)('accepts a generated %s token with production-sized identifiers', (type) => {
    const token = createHandoffToken(
      {
        ...input,
        principalId:
          type === 'web' ? `mcp:${'b'.repeat(64)}` : input.principalId,
        destination: {
          type,
          ...(type === 'native' ? { app: 'storefront' as const } : {}),
        },
      },
      secret
    );
    expect(token.length).toBeGreaterThan(512);
    expect(cartHandoffPairingTokenSchema.safeParse(token).success).toBe(true);
  });

  it('rejects oversized tokens before calling the preview RPC', () => {
    expect(
      cartHandoffPairingTokenSchema.safeParse(`ch1.${'a'.repeat(2048)}.sig`)
        .success
    ).toBe(false);
  });
});
