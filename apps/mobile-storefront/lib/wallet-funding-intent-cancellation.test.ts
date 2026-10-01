import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { asyncStorage } from '@/lib/storage';
import {
  consumeWalletFundingIntent,
  WALLET_FUNDING_INTENT_STORAGE_KEY,
} from './wallet-funding-intent';

jest.mock('@/lib/storage', () => ({
  asyncStorage: {
    getItem: jest.fn(),
    removeItem: jest.fn(),
    setItem: jest.fn(),
  },
}));

const getItem = asyncStorage.getItem as jest.MockedFunction<
  typeof asyncStorage.getItem
>;
const removeItem = asyncStorage.removeItem as jest.MockedFunction<
  typeof asyncStorage.removeItem
>;
const setItem = asyncStorage.setItem as jest.MockedFunction<
  typeof asyncStorage.setItem
>;

describe('consumeWalletFundingIntent cancellation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getItem.mockResolvedValue(
      JSON.stringify({
        customerId: 'customer-1',
        returnTo: '/checkout',
        savedAt: Date.now(),
      })
    );
  });

  it('leaves the single-use intent for a newer tap when consumption is stale', async () => {
    await expect(
      consumeWalletFundingIntent('customer-1', () => false)
    ).resolves.toBeUndefined();

    expect(getItem).toHaveBeenCalledWith(WALLET_FUNDING_INTENT_STORAGE_KEY);
    expect(removeItem).not.toHaveBeenCalled();
  });

  it('restores the snapshot when removal becomes stale while awaiting storage', async () => {
    let finishRemoval: (() => void) | undefined;
    let isCurrent = true;
    const snapshot = JSON.stringify({
      customerId: 'customer-1',
      returnTo: '/checkout',
      savedAt: Date.now(),
    });
    getItem.mockResolvedValue(snapshot);
    removeItem.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishRemoval = resolve;
        })
    );

    const consumption = consumeWalletFundingIntent(
      'customer-1',
      () => isCurrent
    );
    await Promise.resolve();
    await Promise.resolve();
    isCurrent = false;
    finishRemoval?.();

    await expect(consumption).resolves.toBeUndefined();
    expect(setItem).toHaveBeenCalledWith(
      WALLET_FUNDING_INTENT_STORAGE_KEY,
      snapshot
    );
  });
});
