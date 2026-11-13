import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';
import { resolveFundWalletRail } from './resolve-fund-wallet-rail';

const mockGetCapability = jest.fn<(...args: unknown[]) => Promise<boolean>>();
jest.mock('@/lib/piggyvest-primary-capability', () => ({
  getPiggyvestPrimaryCapability: (...args: unknown[]) =>
    mockGetCapability(...args),
}));
let mockSignedInUserId: string | null = '0f8fad5b-d9cb-469f-a165-70867728950e';
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: {
    getState: () => ({
      user: mockSignedInUserId ? { id: mockSignedInUserId } : null,
    }),
  },
}));
jest.mock('@/lib/piggyvest-primary-capability-cache', () => ({
  readObservedPiggyvestPrimaryCapability: () => null,
}));

const MERCHANT = '11111111-1111-4111-8111-111111111111';

describe('wallet top-up rail with the server keeping PiggyVest off', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // The server answers "PiggyVest off" for this merchant.
    mockGetCapability.mockResolvedValue(false);
  });

  it('uses the regular wallet for a plain top-up', async () => {
    await expect(resolveFundWalletRail(MERCHANT)).resolves.toBe('legacy');
  });

  it('uses the regular wallet for a purchase top-up without asking the server', async () => {
    await expect(
      resolveFundWalletRail(MERCHANT, { walletReturnTo: '/imei-check' })
    ).resolves.toBe('legacy');
    expect(mockGetCapability).not.toHaveBeenCalled();
  });
});

describe('bugfix: corrupt saved card funding let a purchase top-up charge again', () => {
  it('blocks a purchase top-up while a saved funding is unreadable', async () => {
    // Arrange: a corrupt saved PiggyVest card funding for this customer.
    const USER = '0f8fad5b-d9cb-469f-a165-70867728950e';
    await AsyncStorage.setItem(`@baci_primary_card:${MERCHANT}:${USER}`, 'x');

    // Act + Assert: never the regular top-up next to it.
    await expect(
      resolveFundWalletRail(MERCHANT, {
        userId: USER,
        walletReturnTo: '/imei-check',
      })
    ).resolves.toBe('blocked');
    await AsyncStorage.clear();
  });

  it('resolves through "Continue anyway": clears the record, then adds store credit', async () => {
    // Arrange
    const USER = '0f8fad5b-d9cb-469f-a165-70867728950e';
    const key = `@baci_primary_card:${MERCHANT}:${USER}`;
    await AsyncStorage.setItem(key, 'x');
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    let retried: Promise<string> | undefined;
    const onRetry = () => {
      retried = resolveFundWalletRail(MERCHANT, {
        userId: USER,
        walletReturnTo: '/imei-check',
      });
    };

    // Act: blocked, then the customer taps "Continue anyway".
    await resolveFundWalletRail(MERCHANT, {
      onRetry,
      userId: USER,
      walletReturnTo: '/imei-check',
    });
    const buttons = alertSpy.mock.calls[0]?.[2] ?? [];
    const proceed = buttons.find((b) => b.text === 'Continue anyway');
    proceed?.onPress?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Assert: the unreadable record is gone and the retry adds store credit.
    expect(await AsyncStorage.getItem(key)).toBeNull();
    await expect(retried).resolves.toBe('legacy');
    alertSpy.mockRestore();
    await AsyncStorage.clear();
  });

  it('does not clear or retry when the account switched while the alert was open', async () => {
    // Arrange
    const USER = '0f8fad5b-d9cb-469f-a165-70867728950e';
    const key = `@baci_primary_card:${MERCHANT}:${USER}`;
    await AsyncStorage.setItem(key, 'x');
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const onRetry = jest.fn();
    await resolveFundWalletRail(MERCHANT, {
      onRetry,
      userId: USER,
      walletReturnTo: '/imei-check',
    });

    // Act: another account signs in, then "Continue anyway" is tapped.
    mockSignedInUserId = '11111111-1111-4111-8111-111111111111';
    const buttons = alertSpy.mock.calls[0]?.[2] ?? [];
    buttons.find((b) => b.text === 'Continue anyway')?.onPress?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Assert: the record stays and the old account's funding never reruns.
    expect(onRetry).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(key)).toBe('x');
    expect(alertSpy).toHaveBeenLastCalledWith(
      'Signed-in account changed',
      expect.any(String)
    );
    mockSignedInUserId = USER;
    alertSpy.mockRestore();
    await AsyncStorage.clear();
  });
});
