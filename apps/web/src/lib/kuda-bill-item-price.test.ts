import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetBillersByCategory = vi.fn();
vi.mock('./kuda-bills', () => ({
  getBillersByCategory: (...args: unknown[]) =>
    mockGetBillersByCategory(...args),
}));

import {
  assertKudaBillItemPriceCurrent,
  clearKudaBillItemPriceCacheForTests,
} from './kuda-bill-item-price';

const startimesSuper = {
  amount: 9500,
  isAmountFixed: true,
  itemCode: 'KUD-CAB-STT-SUPER',
  itemCurrencySymbol: 'NGN',
  itemFee: 0,
  itemName: 'DTT SUPER MONTHLY 9500NGN',
};

function cableBillers() {
  return [
    {
      billerId: 'startimes',
      billerName: 'STARTIMES NG',
      billerType: 'Cable',
      categoryId: 'cable',
      categoryName: 'CableTv',
      billItems: [
        {
          ...startimesSuper,
          amount: 0,
          isAmountFixed: false,
          itemCode: 'group',
          itemName: 'Group',
          billItems: [startimesSuper],
        },
      ],
    },
  ];
}

describe('assertKudaBillItemPriceCurrent', () => {
  beforeEach(() => {
    clearKudaBillItemPriceCacheForTests();
    mockGetBillersByCategory.mockReset();
    mockGetBillersByCategory.mockResolvedValue(cableBillers());
  });

  describe('bugfix: a saved 100x cable price could still be charged', () => {
    it('rejects a cable package sent at the old 100x price', async () => {
      await expect(
        assertKudaBillItemPriceCurrent({
          amount: 950000,
          billItemIdentifier: 'KUD-CAB-STT-SUPER',
          type: 'cable_tv',
        })
      ).rejects.toThrow(
        'The price of DTT SUPER MONTHLY 9500NGN has changed. Please refresh and choose your package again.'
      );
      expect(mockGetBillersByCategory).toHaveBeenCalledWith('cable_tv');
    });
  });

  it('accepts a cable package at its current price', async () => {
    await expect(
      assertKudaBillItemPriceCurrent({
        amount: 9500,
        billItemIdentifier: 'KUD-CAB-STT-SUPER',
        type: 'cable_tv',
      })
    ).resolves.toBeUndefined();
  });

  it('leaves unknown items to the provider', async () => {
    await expect(
      assertKudaBillItemPriceCurrent({
        amount: 1234,
        billItemIdentifier: 'KUD-CAB-UNKNOWN',
        type: 'cable_tv',
      })
    ).resolves.toBeUndefined();
  });

  it('does not look up open-amount bill types', async () => {
    await assertKudaBillItemPriceCurrent({
      amount: 5000,
      billItemIdentifier: 'KUD-ELE-EKED-002',
      type: 'electricity',
    });

    expect(mockGetBillersByCategory).not.toHaveBeenCalled();
  });

  it('reuses the price list for a minute', async () => {
    const input = {
      amount: 9500,
      billItemIdentifier: 'KUD-CAB-STT-SUPER',
      type: 'cable_tv' as const,
    };

    await assertKudaBillItemPriceCurrent(input);
    await assertKudaBillItemPriceCurrent(input);

    expect(mockGetBillersByCategory).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the price list cannot be read', async () => {
    mockGetBillersByCategory.mockRejectedValue(new Error('Kuda down'));

    await expect(
      assertKudaBillItemPriceCurrent({
        amount: 9500,
        billItemIdentifier: 'KUD-CAB-STT-SUPER',
        type: 'cable_tv',
      })
    ).rejects.toThrow('Kuda down');
  });
});
