import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  clearPendingImeiLookup,
  loadPendingImeiLookup,
  pendingImeiStorageKey,
  savePendingImeiLookup,
} from './imei-pending-storage';

describe('mobile pending IMEI storage', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('scopes state to merchant and customer', () => {
    expect(pendingImeiStorageKey('merchant-1', 'customer-1')).toBe(
      'baci:imei-pending:v1:merchant-1:customer-1'
    );
  });

  it('round-trips and clears pending state', async () => {
    const key = pendingImeiStorageKey('merchant-1', 'customer-1');
    const pending = {
      createdAt: '2026-07-10T12:00:00.000Z',
      lookupId: '11111111-1111-4111-8111-111111111111',
      tier: 'blacklist' as const,
    };

    await savePendingImeiLookup(key, pending);
    await expect(loadPendingImeiLookup(key)).resolves.toEqual(pending);
    await clearPendingImeiLookup(key);
    await expect(loadPendingImeiLookup(key)).resolves.toBeNull();
  });

  it('keeps the saved store credit key that started the lookup', async () => {
    const key = pendingImeiStorageKey('merchant-1', 'customer-1');
    const pending = {
      createdAt: '2026-07-10T12:00:00.000Z',
      lookupId: '11111111-1111-4111-8111-111111111111',
      tier: 'blacklist' as const,
      request: {
        key: '22222222-2222-4222-8222-222222222222',
        purchase: 'imei-credit|user-1|merchant-1|smartphone|blacklist|abc',
      },
    };

    await savePendingImeiLookup(key, pending);
    await expect(loadPendingImeiLookup(key)).resolves.toEqual(pending);
  });

  it('drops a malformed saved key but keeps the lookup', async () => {
    const key = pendingImeiStorageKey('merchant-1', 'customer-1');
    await AsyncStorage.setItem(
      key,
      JSON.stringify({
        createdAt: '2026-07-10T12:00:00.000Z',
        lookupId: '11111111-1111-4111-8111-111111111111',
        tier: 'blacklist',
        request: { key: 'not-a-uuid', purchase: 'imei-credit|x' },
      })
    );

    const loaded = await loadPendingImeiLookup(key);
    expect(loaded?.lookupId).toBe('11111111-1111-4111-8111-111111111111');
    expect(loaded).not.toHaveProperty('request');
  });
});
