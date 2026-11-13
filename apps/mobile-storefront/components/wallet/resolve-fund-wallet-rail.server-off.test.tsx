import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { resolveFundWalletRail } from './resolve-fund-wallet-rail';

const mockGetCapability = jest.fn<(...args: unknown[]) => Promise<boolean>>();
jest.mock('@/lib/piggyvest-primary-capability', () => ({
  getPiggyvestPrimaryCapability: (...args: unknown[]) =>
    mockGetCapability(...args),
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
});
