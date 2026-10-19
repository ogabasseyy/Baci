import { afterEach, describe, expect, it, vi } from 'vitest';
import { redemptionIdempotencyKeys } from './loyalty-redemption-keys';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('redemptionIdempotencyKeys', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns a stable key per intent until cleared', async () => {
    const first = await redemptionIdempotencyKeys.forReward(
      'm',
      'c',
      'reward-a'
    );
    const second = await redemptionIdempotencyKeys.forReward(
      'm',
      'c',
      'reward-a'
    );
    const other = await redemptionIdempotencyKeys.forReward(
      'm',
      'c',
      'reward-b'
    );

    expect(first).toMatch(UUID_PATTERN);
    expect(second).toBe(first);
    expect(other).not.toBe(first);

    redemptionIdempotencyKeys.clearForReward('m', 'c', 'reward-a');
    expect(
      await redemptionIdempotencyKeys.forReward('m', 'c', 'reward-a')
    ).not.toBe(first);

    redemptionIdempotencyKeys.clearForReward('m', 'c', 'reward-b');
  });

  it('scopes keys by merchant and customer, not just reward', async () => {
    const one = await redemptionIdempotencyKeys.forReward(
      'm1',
      'c',
      'reward-a'
    );
    const otherMerchant = await redemptionIdempotencyKeys.forReward(
      'm2',
      'c',
      'reward-a'
    );
    const otherCustomer = await redemptionIdempotencyKeys.forReward(
      'm1',
      'c2',
      'reward-a'
    );

    expect(otherMerchant).not.toBe(one);
    expect(otherCustomer).not.toBe(one);

    redemptionIdempotencyKeys.clearForReward('m1', 'c', 'reward-a');
    redemptionIdempotencyKeys.clearForReward('m2', 'c', 'reward-a');
    redemptionIdempotencyKeys.clearForReward('m1', 'c2', 'reward-a');
  });

  it('replays the stored key after a reload clears the module cache', async () => {
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

    // Fresh module = fresh Map, as after a page reload.
    vi.resetModules();
    const reloaded = await import('./loyalty-redemption-keys');
    const before = await redemptionIdempotencyKeys.forReward(
      'm',
      'c',
      'reward-r'
    );
    const after = await reloaded.redemptionIdempotencyKeys.forReward(
      'm',
      'c',
      'reward-r'
    );

    expect(after).toBe(before);

    reloaded.redemptionIdempotencyKeys.clearForReward('m', 'c', 'reward-r');
    expect(store.size).toBe(0);
    redemptionIdempotencyKeys.clearForReward('m', 'c', 'reward-r');
  });

  it('does not reuse a key another tab cleared after success', async () => {
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

    const first = await redemptionIdempotencyKeys.forReward(
      'm',
      'c',
      'reward-x'
    );
    // Another tab redeemed successfully: it clears storage and its own
    // Map, but this tab's Map still holds the spent key.
    store.clear();

    const second = await redemptionIdempotencyKeys.forReward(
      'm',
      'c',
      'reward-x'
    );
    expect(second).not.toBe(first);
    expect(second).toMatch(UUID_PATTERN);

    redemptionIdempotencyKeys.clearForReward('m', 'c', 'reward-x');
  });

  it('does not clear a newer key when a delayed success names the old one', async () => {
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

    // Tab A completes with the shared key; a retry in tab B already
    // minted and stored a replacement for the next redemption. Tab A's
    // delayed clear of the completed key must leave the replacement.
    const intent = 'loyalty-redeem-key:m:c:reward-race';
    store.set(intent, 'replacement-key');
    redemptionIdempotencyKeys.clearForReward(
      'm',
      'c',
      'reward-race',
      'completed-key'
    );
    expect(store.get(intent)).toBe('replacement-key');

    // Clearing with the currently stored key still clears.
    redemptionIdempotencyKeys.clearForReward(
      'm',
      'c',
      'reward-race',
      'replacement-key'
    );
    expect(store.has(intent)).toBe(false);
  });

  it('clears the stored key on success', async () => {
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

    await redemptionIdempotencyKeys.forReward('m', 'c', 'reward-s');
    expect(store.size).toBe(1);
    redemptionIdempotencyKeys.clearForReward('m', 'c', 'reward-s');
    expect(store.size).toBe(0);
  });

  it('adopts the key another tab stored while waiting on the lock', async () => {
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
    // The other tab wins the lock first and stores its key before this
    // tab's lock callback runs.
    vi.stubGlobal('navigator', {
      locks: {
        request: async (_name: string, callback: () => Promise<string>) => {
          store.set(
            'loyalty-redeem-key:m:c:reward-lock',
            '11111111-1111-4111-8111-111111111111'
          );
          return callback();
        },
      },
    });

    const key = await redemptionIdempotencyKeys.forReward(
      'm',
      'c',
      'reward-lock'
    );
    expect(key).toBe('11111111-1111-4111-8111-111111111111');

    redemptionIdempotencyKeys.clearForReward('m', 'c', 'reward-lock');
  });

  it('mints inside the lock when storage is still empty', async () => {
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
    let lockName = '';
    vi.stubGlobal('navigator', {
      locks: {
        request: async (name: string, callback: () => Promise<string>) => {
          lockName = name;
          return callback();
        },
      },
    });

    const key = await redemptionIdempotencyKeys.forReward(
      'm',
      'c',
      'reward-mint'
    );
    expect(key).toMatch(UUID_PATTERN);
    expect(lockName).toBe('loyalty-redeem-key:m:c:reward-mint:lock');
    expect(store.get('loyalty-redeem-key:m:c:reward-mint')).toBe(key);

    redemptionIdempotencyKeys.clearForReward('m', 'c', 'reward-mint');
  });
});
