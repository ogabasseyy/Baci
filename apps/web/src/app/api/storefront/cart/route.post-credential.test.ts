import { afterEach, describe, expect, it, vi } from 'vitest';
import { CART_QUOTA_BUDGETS, checkCartQuota } from '@/lib/cart/request-context';
import {
  bootstrapProofFor,
  cartCookie,
  GRANT_ID,
  MERCHANT,
  mocks,
  postCart,
  rawState,
} from './route.test-support';

const mockGetRedis = vi.hoisted(() => vi.fn(() => null as unknown));

vi.mock('@/lib/redis', () => ({ getRedis: mockGetRedis }));

/** Healthy shared quota store: per-key counting fake Redis. */
function useHealthyRedis(): void {
  const counts = new Map<string, number>();
  mockGetRedis.mockReturnValue({
    createScript: () => ({
      eval: async (keys: string[]) => {
        const key = keys[0] ?? '';
        const next = (counts.get(key) ?? 0) + 1;
        counts.set(key, next);
        return [next, 3_600_000];
      },
    }),
  });
}

afterEach(() => {
  mockGetRedis.mockReturnValue(null);
});

describe('POST /api/storefront/cart client credential quotas', () => {
  it('gives distinct client credentials independent create budgets', async () => {
    // Per-credential fairness applies while the shared store is healthy.
    useHealthyRedis();
    mocks.cartPayload = {
      code: null,
      grantId: GRANT_ID,
      ok: true,
      replayed: false,
      state: rawState(),
    };
    const credentialA = '11111111-1111-4111-8111-111111111111';
    const credentialB = '22222222-2222-4222-8222-222222222222';
    const attempt = (credential: string, index: number) =>
      postCart({
        body: { operationId: `create-cred-${index}` },
        headers: {
          cookie: cartCookie(bootstrapProofFor(`guest-cred-${index}`)),
          'x-baci-client-credential': credential,
        },
      });
    for (let index = 0; index < 10; index++) {
      expect((await attempt(credentialA, index)).status).toBe(201);
    }
    expect((await attempt(credentialA, 10)).status).toBe(429);
    // The second shopper behind the same network identity can create.
    expect((await attempt(credentialB, 11)).status).toBe(201);
  });

  it('bounds credential rotation with the network backstop', async () => {
    mocks.cartPayload = {
      code: null,
      grantId: GRANT_ID,
      ok: true,
      replayed: false,
      state: rawState(),
    };
    // Fill this network identity's backstop bucket directly (the
    // harness requests carry no platform address, so their trusted
    // network identity is the shared 'unknown' subject).
    for (
      let index = 0;
      index < CART_QUOTA_BUDGETS.create_network_backstop.limit;
      index++
    ) {
      await checkCartQuota({
        merchantId: MERCHANT.id,
        operation: 'create_network_backstop',
        subject: 'unknown',
      });
    }
    const response = await postCart({
      body: { operationId: 'create-rotated-credential' },
      headers: {
        cookie: cartCookie(bootstrapProofFor('guest-rotated')),
        'x-baci-client-credential': '33333333-3333-4333-8333-333333333333',
      },
    });
    expect(response.status).toBe(429);
    expect((await response.json()).code).toBe('quota_exceeded');
  });
});
