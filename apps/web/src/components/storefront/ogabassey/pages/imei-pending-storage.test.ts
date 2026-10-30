import { describe, expect, it, vi } from 'vitest';
import {
  clearPendingImeiLookup,
  loadPendingImeiLookup,
  pendingImeiStorageKey,
  savePendingImeiLookup,
} from './imei-pending-storage';

describe('pending IMEI storage', () => {
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
