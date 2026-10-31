import { describe, expect, it, vi } from 'vitest';
import {
  clearPendingImeiLookup,
  loadPendingImeiLookup,
  pendingImeiStorageKey,
  savePendingImeiLookup,
} from './imei-pending-storage';

describe('pending IMEI storage', () => {
  const pending = {
    createdAt: '2026-07-10T12:00:00.000Z',
    lookupId: '11111111-1111-4111-8111-111111111111',
    tier: 'simLock' as const,
  };

  it.each([
    'toaster',
    'laptop',
  ])('omits incompatible stored device %s without losing the lookup', (device) => {
    const adapter = {
      getItem: () => JSON.stringify({ ...pending, device }),
      removeItem: vi.fn(),
      setItem: vi.fn(),
    };
    expect(loadPendingImeiLookup(adapter, 'key')).toEqual(pending);
    expect(adapter.removeItem).not.toHaveBeenCalled();
  });

  it('does not let a failed write or removal interrupt lookup progress', () => {
    const adapter = {
      getItem: () => null,
      removeItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(() => savePendingImeiLookup(adapter, 'key', pending)).not.toThrow();
    expect(savePendingImeiLookup(adapter, 'key', pending)).toBe(false);
    expect(() => clearPendingImeiLookup(adapter, 'key')).not.toThrow();
  });

  it('handles unavailable reads without deleting potentially valid recovery data', () => {
    const adapter = {
      getItem: () => {
        throw new Error('denied');
      },
      removeItem: vi.fn(),
      setItem: vi.fn(),
    };
    expect(loadPendingImeiLookup(adapter, 'key')).toBeNull();
    expect(adapter.removeItem).not.toHaveBeenCalled();
  });

  it('handles malformed storage even when removal fails', () => {
    const adapter = {
      getItem: () => '{',
      removeItem: () => {
        throw new Error('denied');
      },
      setItem: vi.fn(),
    };
    expect(loadPendingImeiLookup(adapter, 'key')).toBeNull();
  });

  it('scopes pending lookups to storefront host, merchant, and customer', () => {
    expect(
      pendingImeiStorageKey('shop.example.com', 'customer-1', 'OgaBassey')
    ).toBe('baci:imei-pending:v2:shop.example.com:ogabassey:customer-1');
  });

  it('round-trips and clears a valid pending lookup', () => {
    const storage = new Map<string, string>();
    const adapter = {
      getItem: (key: string) => storage.get(key) ?? null,
      removeItem: (key: string) => storage.delete(key),
      setItem: (key: string, value: string) => storage.set(key, value),
    };
    const key = pendingImeiStorageKey(
      'shop.example.com',
      'customer-1',
      'ogabassey'
    );
    const pending = {
      createdAt: '2026-07-10T12:00:00.000Z',
      lookupId: '11111111-1111-4111-8111-111111111111',
      tier: 'blacklist' as const,
      device: 'smartphone' as const,
    };

    savePendingImeiLookup(adapter, key, pending);
    expect(loadPendingImeiLookup(adapter, key)).toEqual(pending);
    clearPendingImeiLookup(adapter, key);
    expect(loadPendingImeiLookup(adapter, key)).toBeNull();
  });

  it('deletes malformed storage rather than resuming it', () => {
    const removeItem = vi.fn();
    const adapter = {
      getItem: () => '{"lookupId":"not-a-uuid"}',
      removeItem,
      setItem: vi.fn(),
    };

    expect(loadPendingImeiLookup(adapter, 'key')).toBeNull();
    expect(removeItem).toHaveBeenCalledWith('key');
  });
});

it('restores the recovery identity associated with a pending lookup', () => {
  const recovery = { storageKey: `baci:imei-attempt:v1:${'a'.repeat(64)}`, idempotencyKey: '11111111-1111-4111-8111-111111111111' };
  const adapter = { getItem: () => JSON.stringify({ createdAt: '2026-07-10T12:00:00.000Z', lookupId: '22222222-2222-4222-8222-222222222222', tier: 'simLock', recovery }), removeItem: vi.fn(), setItem: vi.fn() };
  expect(loadPendingImeiLookup(adapter, 'key')?.recovery).toEqual(recovery);
});
