import { afterEach, describe, expect, it, vi } from 'vitest';
import { redemptionIdempotencyKeys } from './loyalty-redemption-keys';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('redemptionIdempotencyKeys', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns a stable key per intent until cleared', () => {
    const first = redemptionIdempotencyKeys.forReward('m', 'c', 'reward-a');
    const second = redemptionIdempotencyKeys.forReward('m', 'c', 'reward-a');
    const other = redemptionIdempotencyKeys.forReward('m', 'c', 'reward-b');

    expect(first).toMatch(UUID_PATTERN);
    expect(second).toBe(first);
    expect(other).not.toBe(first);

    redemptionIdempotencyKeys.clearForReward('m', 'c', 'reward-a');
    expect(redemptionIdempotencyKeys.forReward('m', 'c', 'reward-a')).not.toBe(
      first
    );

    redemptionIdempotencyKeys.clearForReward('m', 'c', 'reward-b');
  });

  it('scopes keys by merchant and customer, not just reward', () => {
    const one = redemptionIdempotencyKeys.forReward('m1', 'c', 'reward-a');
    const otherMerchant = redemptionIdempotencyKeys.forReward(
      'm2',
      'c',
      'reward-a'
    );
    const otherCustomer = redemptionIdempotencyKeys.forReward(
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
    const before = redemptionIdempotencyKeys.forReward('m', 'c', 'reward-r');
    const after = reloaded.redemptionIdempotencyKeys.forReward(
      'm',
      'c',
      'reward-r'
    );

    expect(after).toBe(before);

    reloaded.redemptionIdempotencyKeys.clearForReward('m', 'c', 'reward-r');
    expect(store.size).toBe(0);
    redemptionIdempotencyKeys.clearForReward('m', 'c', 'reward-r');
  });

  it('clears the stored key on success', () => {
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

    redemptionIdempotencyKeys.forReward('m', 'c', 'reward-s');
    expect(store.size).toBe(1);
    redemptionIdempotencyKeys.clearForReward('m', 'c', 'reward-s');
    expect(store.size).toBe(0);
  });
});
