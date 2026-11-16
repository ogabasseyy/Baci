import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook } from '@testing-library/react-native';
import { walletPayPurchaseKeys } from '@/components/wallet-pay/wallet-pay-purchase-keys';
import { useImeiRequestIdentity } from './use-imei-request-identity';

const mockAuth: { user: { id: string } | null } = { user: { id: 'user-1' } };
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: { getState: () => mockAuth },
}));

const IMEI = '490154203237518';
const keys = (...values: string[]) => {
  const createKey = jest.fn<() => string>();
  for (const value of values) createKey.mockReturnValueOnce(value);
  return createKey;
};
const keyOf = async (
  identity: ReturnType<typeof useImeiRequestIdentity>,
  ...args: Parameters<ReturnType<typeof useImeiRequestIdentity>['get']>
) => (await identity.get(...args))?.key;
/** Waits for the key store's queued removals to land. */
const settle = () => walletPayPurchaseKeys.has('flush');

beforeEach(async () => {
  mockAuth.user = { id: 'user-1' };
  await AsyncStorage.clear();
  walletPayPurchaseKeys.resetMemory();
});

describe('useImeiRequestIdentity', () => {
  it('reuses an idempotency key for the same identifier and tier', async () => {
    const createKey = keys('key-1', 'key-2');
    const { result } = renderHook(() => useImeiRequestIdentity(createKey));

    await expect(keyOf(result.current, 'blacklist', IMEI)).resolves.toBe(
      'key-1'
    );
    await expect(keyOf(result.current, 'blacklist', IMEI)).resolves.toBe(
      'key-1'
    );
    act(() => result.current.clear());
    await settle();
    await expect(keyOf(result.current, 'blacklist', IMEI)).resolves.toBe(
      'key-2'
    );
  });

  it('saves the key on the phone before handing it out', async () => {
    const { result } = renderHook(() => useImeiRequestIdentity(keys('key-1')));

    const identity = await result.current.get('blacklist', IMEI, 'smartphone');

    expect(identity?.saved?.key).toBe('key-1');
    expect(identity?.saved?.purchase).toMatch(/^imei-credit\|user-1\|/);
    walletPayPurchaseKeys.resetMemory();
    await expect(
      walletPayPurchaseKeys.has(identity?.saved?.purchase ?? '')
    ).resolves.toBe(true);
  });
});

describe('bugfix: a killed app minted a second key for a paid check', () => {
  it('retains and reuses the saved key after a restart', async () => {
    const before = renderHook(() => useImeiRequestIdentity(keys('key-1')));
    await before.result.current.get('blacklist', IMEI, 'smartphone');
    before.unmount();
    walletPayPurchaseKeys.resetMemory();

    const after = renderHook(() => useImeiRequestIdentity(keys('key-2')));
    await expect(
      after.result.current.retains('blacklist', IMEI, 'smartphone')
    ).resolves.toBe(true);
    await expect(
      keyOf(after.result.current, 'blacklist', IMEI, 'smartphone')
    ).resolves.toBe('key-1');
  });

  it('retires the key a restored lookup brings once it is final', async () => {
    const before = renderHook(() => useImeiRequestIdentity(keys('key-1')));
    const first = await before.result.current.get(
      'blacklist',
      IMEI,
      'smartphone'
    );
    before.unmount();
    walletPayPurchaseKeys.resetMemory();

    const after = renderHook(() => useImeiRequestIdentity(keys('key-2')));
    act(() => after.result.current.clear(first?.saved));
    await settle();

    await expect(
      after.result.current.retains('blacklist', IMEI, 'smartphone')
    ).resolves.toBe(false);
    await expect(
      keyOf(after.result.current, 'blacklist', IMEI, 'smartphone')
    ).resolves.toBe('key-2');
  });

  it('keeps an in-memory key when the phone cannot save it', async () => {
    const setItem = jest
      .spyOn(AsyncStorage, 'setItem')
      .mockRejectedValue(new Error('disk full'));
    const { result } = renderHook(() =>
      useImeiRequestIdentity(keys('key-1', 'key-2'))
    );

    const identity = await result.current.get('blacklist', IMEI);

    expect(identity).toEqual({ key: 'key-2', saved: undefined });
    await expect(keyOf(result.current, 'blacklist', IMEI)).resolves.toBe(
      'key-2'
    );
    setItem.mockRestore();
  });
});

describe('bugfix: a retry typed differently forked a retained request (Muse)', () => {
  it('treats spacing, dashes and case as the same identifier', async () => {
    const createKey = jest.fn(() => 'key-1');
    const { result } = renderHook(() => useImeiRequestIdentity(createKey));
    await expect(keyOf(result.current, 'basic', 'c02xl0abjgh5')).resolves.toBe(
      'key-1'
    );
    await expect(
      result.current.retains('basic', ' C02X-L0AB-JGH5 ')
    ).resolves.toBe(true);
    await expect(keyOf(result.current, 'basic', 'C02XL0ABJGH5')).resolves.toBe(
      'key-1'
    );
    expect(createKey).toHaveBeenCalledTimes(1);
  });
});

describe('bugfix: a store credit key replayed for another account (Muse)', () => {
  it('never retains or reuses a key across an account switch', async () => {
    const { result } = renderHook(() =>
      useImeiRequestIdentity(keys('key-a', 'key-b'))
    );
    await expect(keyOf(result.current, 'basic', IMEI)).resolves.toBe('key-a');
    mockAuth.user = { id: 'user-2' };
    await expect(result.current.retains('basic', IMEI)).resolves.toBe(false);
    await expect(keyOf(result.current, 'basic', IMEI)).resolves.toBe('key-b');
  });

  it('sends nothing when the account switches while the key is read', async () => {
    const createKey = jest.fn(() => {
      mockAuth.user = { id: 'user-2' };
      return 'key-a';
    });
    const { result } = renderHook(() => useImeiRequestIdentity(createKey));

    await expect(result.current.get('basic', IMEI)).resolves.toBeNull();
  });
});

describe('bugfix: a store credit key replayed for another device tab (Muse)', () => {
  it('mints a new key and does not retain when the device changes', async () => {
    const { result } = renderHook(() =>
      useImeiRequestIdentity(keys('key-phone', 'key-laptop'))
    );
    await expect(
      keyOf(result.current, 'basic', IMEI, 'smartphone')
    ).resolves.toBe('key-phone');
    await expect(result.current.retains('basic', IMEI, 'laptop')).resolves.toBe(
      false
    );
    await expect(keyOf(result.current, 'basic', IMEI, 'laptop')).resolves.toBe(
      'key-laptop'
    );
  });
});
