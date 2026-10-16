import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { redemptionIdempotencyKeys } from './loyalty-redemption-keys';

// Fake timers drive the claim protocol's poll/settle delays and the
// controlled clock: wall-clock waits made this suite nondeterministic
// on stalled CI workers.
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function settle<T>(promise: Promise<T>, ms = 1_000): Promise<T> {
  await vi.advanceTimersByTimeAsync(ms);
  return promise;
}

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

    const key = await settle(
      redemptionIdempotencyKeys.forReward('m', 'c', 'reward-solo')
    );
    expect(key).toMatch(UUID_PATTERN);
    expect(store.get('loyalty-redeem-key:m:c:reward-solo')).toBe(key);
    expect(store.has('loyalty-redeem-key:m:c:reward-solo:claim')).toBe(false);

    redemptionIdempotencyKeys.clearForReward('m', 'c', 'reward-solo');
  });

  it('mints immediately through the Map when storage is unusable', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('storage disabled');
      },
      removeItem: () => {},
    });

    const startedAt = Date.now();
    const key = await redemptionIdempotencyKeys.forReward(
      'm',
      'c',
      'reward-nostorage'
    );
    // No 30-second claim wait: unusable storage degrades to Map-only.
    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(key).toMatch(UUID_PATTERN);
    expect(
      await redemptionIdempotencyKeys.forReward('m', 'c', 'reward-nostorage')
    ).toBe(key);

    redemptionIdempotencyKeys.clearForReward('m', 'c', 'reward-nostorage');
  });

  it('keeps waiting while another tab\u2019s claim is live, then adopts its key', async () => {
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
    // A winning tab has claimed but not yet stored its key (e.g. it
    // was suspended mid-mint); its claim stays live well past the old
    // bounded wait. Minting a competing key here is exactly the
    // double-spend the claim protocol exists to prevent.
    store.set(
      'loyalty-redeem-key:m:c:reward-wait:claim',
      JSON.stringify({
        token: '00000000-0000-4000-8000-000000000000',
        expiresAt: Date.now() + 10_000,
      })
    );
    const pending = redemptionIdempotencyKeys.forReward(
      'm',
      'c',
      'reward-wait'
    );
    // Polls pass while the winner's claim stays live: no mint yet.
    await vi.advanceTimersByTimeAsync(150);
    expect(store.has('loyalty-redeem-key:m:c:reward-wait')).toBe(false);
    // The winner resumes and publishes its key while we wait.
    store.set(
      'loyalty-redeem-key:m:c:reward-wait',
      '44444444-4444-4444-8444-444444444444'
    );
    const key = await settle(pending, 200);
    expect(key).toBe('44444444-4444-4444-8444-444444444444');
    expect(store.get('loyalty-redeem-key:m:c:reward-wait')).toBe(
      '44444444-4444-4444-8444-444444444444'
    );
    redemptionIdempotencyKeys.clearForReward('m', 'c', 'reward-wait');
  });

  it('mints after the observed claim expires without a key', async () => {
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
    // The claimant crashed after staking: once its claim expires the
    // intent must not stay blocked.
    store.set(
      'loyalty-redeem-key:m:c:reward-expired:claim',
      JSON.stringify({
        token: '00000000-0000-4000-8000-000000000000',
        expiresAt: Date.now() + 120,
      })
    );

    const key = await settle(
      redemptionIdempotencyKeys.forReward('m', 'c', 'reward-expired'),
      2_000
    );
    expect(key).toMatch(UUID_PATTERN);
    expect(store.get('loyalty-redeem-key:m:c:reward-expired')).toBe(key);

    redemptionIdempotencyKeys.clearForReward('m', 'c', 'reward-expired');
  });

  it('adopts the surviving stored key after a simultaneous mint', async () => {
    const store = new Map<string, string>();
    let overwrote = false;
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
        // A simultaneous claimant stores its key in the same window,
        // just after our mint lands.
        if (key === 'loyalty-redeem-key:m:c:reward-settle' && !overwrote) {
          overwrote = true;
          store.set(key, '55555555-5555-4555-8555-555555555555');
        }
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    });

    const key = await settle(
      redemptionIdempotencyKeys.forReward('m', 'c', 'reward-settle')
    );
    expect(key).toBe('55555555-5555-4555-8555-555555555555');

    redemptionIdempotencyKeys.clearForReward('m', 'c', 'reward-settle');
  });

  it('does not mint when its claim is overwritten during the settle window', async () => {
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

    const pending = redemptionIdempotencyKeys.forReward(
      'm',
      'c',
      'reward-overwritten'
    );
    // Our claim is staked and the settle window is running; a
    // simultaneous claimant overwrites the claim record mid-window.
    await vi.advanceTimersByTimeAsync(10);
    store.set(
      'loyalty-redeem-key:m:c:reward-overwritten:claim',
      JSON.stringify({
        token: '00000000-0000-4000-8000-000000000000',
        expiresAt: Date.now() + 10_000,
      })
    );
    await vi.advanceTimersByTimeAsync(100);
    // The overwriting claimant publishes its key; we must adopt it
    // rather than mint a competing one.
    store.set(
      'loyalty-redeem-key:m:c:reward-overwritten',
      '66666666-6666-4666-8666-666666666666'
    );
    const key = await settle(pending, 500);
    expect(key).toBe('66666666-6666-4666-8666-666666666666');
    expect(store.get('loyalty-redeem-key:m:c:reward-overwritten')).toBe(
      '66666666-6666-4666-8666-666666666666'
    );

    redemptionIdempotencyKeys.clearForReward('m', 'c', 'reward-overwritten');
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
