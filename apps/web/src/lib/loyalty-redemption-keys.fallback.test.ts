import { describe, expect, it, vi } from 'vitest';
import { redemptionIdempotencyKeys } from './loyalty-redemption-keys';

// Fallback coordination (no Web Locks / locks throwing), split from
// loyalty-redemption-keys.test.ts for the 300-line limit.
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('redemptionIdempotencyKeys fallback coordination', () => {
  it('converges on the stored key without locks when another tab claimed first', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    });
    // No navigator.locks in this environment: the fallback claim
    // protocol runs. A winning tab's key is already stored (and its
    // claim still live) when this tab starts, so this tab must adopt
    // the stored key instead of minting a competing one.
    store.set(
      'loyalty-redeem-key:m:c:reward-nolock:claim',
      JSON.stringify({
        token: '00000000-0000-4000-8000-000000000000',
        expiresAt: Date.now() + 10_000,
      })
    );
    store.set(
      'loyalty-redeem-key:m:c:reward-nolock',
      '22222222-2222-4222-8222-222222222222'
    );

    const key = await redemptionIdempotencyKeys.forReward(
      'm',
      'c',
      'reward-nolock'
    );
    expect(key).toBe('22222222-2222-4222-8222-222222222222');

    redemptionIdempotencyKeys.clearForReward('m', 'c', 'reward-nolock');
  });

  it('mints without locks and clears its claim record', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    });

    const key = await redemptionIdempotencyKeys.forReward(
      'm',
      'c',
      'reward-solo'
    );
    expect(key).toMatch(UUID_PATTERN);
    expect(store.get('loyalty-redeem-key:m:c:reward-solo')).toBe(key);
    expect(store.has('loyalty-redeem-key:m:c:reward-solo:claim')).toBe(false);

    redemptionIdempotencyKeys.clearForReward('m', 'c', 'reward-solo');
  });

  it('coordinates through the claim protocol when locks throw', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    });
    vi.stubGlobal('navigator', {
      locks: {
        request: async () => {
          throw new Error('locks unavailable');
        },
      },
    });
    // The winning tab published its key before this tab's lock threw.
    store.set(
      'loyalty-redeem-key:m:c:reward-throw',
      '33333333-3333-4333-8333-333333333333'
    );

    const key = await redemptionIdempotencyKeys.forReward(
      'm',
      'c',
      'reward-throw'
    );
    expect(key).toBe('33333333-3333-4333-8333-333333333333');

    redemptionIdempotencyKeys.clearForReward('m', 'c', 'reward-throw');
  });
});
