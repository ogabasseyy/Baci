import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { walletPayPurchaseKeys } from './wallet-pay-purchase-keys';

const STORAGE_KEY = 'baci.walletPay.openPurchases.v1';
const originalNavigator = Object.getOwnPropertyDescriptor(
  globalThis,
  'navigator'
);

function setLocks(locks: unknown) {
  Object.defineProperty(globalThis, 'navigator', {
    value: { locks },
    configurable: true,
    writable: true,
  });
}

beforeEach(async () => {
  await AsyncStorage.clear();
  walletPayPurchaseKeys.resetMemory();
  jest.replaceProperty(Platform, 'OS', 'web');
});
afterEach(() => {
  jest.restoreAllMocks();
  if (originalNavigator)
    Object.defineProperty(globalThis, 'navigator', originalNavigator);
});

describe('bugfix: two browser tabs could mint two keys for one purchase (Codex P1)', () => {
  it('re-reads storage under the tab lock, so a key another tab saved is reused', async () => {
    const request = jest.fn(
      async (_name: string, callback: () => Promise<unknown>) => callback()
    );
    setLocks({ request });
    await expect(walletPayPurchaseKeys.keyFor('p', () => 'a')).resolves.toBe(
      'a'
    );
    // Another tab saved a key meanwhile; this tab's memory has not seen it.
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ q: { key: 'other-tab', at: Date.now() } })
    );
    await expect(walletPayPurchaseKeys.keyFor('q', () => 'b')).resolves.toBe(
      'other-tab'
    );
    expect(request).toHaveBeenCalledWith(
      'baci:wallet-pay-keys/v1',
      expect.any(Function)
    );
  });

  it('refuses (fails closed) in a browser without a tab lock', async () => {
    setLocks(undefined);
    await expect(walletPayPurchaseKeys.keyFor('p', () => 'a')).rejects.toThrow(
      'tab lock'
    );
  });
});
