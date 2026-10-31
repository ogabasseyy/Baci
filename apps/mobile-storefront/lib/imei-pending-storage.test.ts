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
});

it('restores the recovery identity associated with a pending lookup', async () => {
  const recovery = {
    storageKey: `imei-attempt-v1-${'a'.repeat(64)}`,
    idempotencyKey: '11111111-1111-4111-8111-111111111111',
  };
  await AsyncStorage.setItem(
    'recovery-test',
    JSON.stringify({
      createdAt: '2026-07-10T12:00:00.000Z',
      lookupId: '22222222-2222-4222-8222-222222222222',
      tier: 'simLock',
      recovery,
    })
  );
  expect((await loadPendingImeiLookup('recovery-test'))?.recovery).toEqual(
    recovery
  );
});
