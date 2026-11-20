import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetBillersByCategory = vi.fn();
vi.mock('./kuda-bills', () => ({
  getBillersByCategory: (...args: unknown[]) =>
    mockGetBillersByCategory(...args),
}));
vi.mock('./logger', () => ({ logger: { warn: vi.fn() } }));

import {
  assertKudaBillItemPriceCurrent,
  clearKudaBillItemPriceCacheForTests,
} from './kuda-bill-item-price';
import {
  KUDA_BILL_PRICE_CHANGED_MESSAGE,
  KUDA_BILL_PRICE_UNCONFIRMED_MESSAGE,
} from './kuda-bill-item-price-messages';

function cableBiller(billerName: string, amount: number) {
  return {
    billerId: billerName,
    billerName,
    billerType: 'Cable',
    categoryId: 'cable',
    categoryName: 'CableTv',
    billItems: [
      {
        amount,
        isAmountFixed: true,
        itemCode: 'KUD-CAB-DST-SHARED',
        itemCurrencySymbol: 'NGN',
        itemFee: 0,
        itemName: 'Shared package',
      },
    ],
  };
}

const purchase = (amount: number, billerName?: string) =>
  assertKudaBillItemPriceCurrent({
    amount,
    billItemIdentifier: 'KUD-CAB-DST-SHARED',
    ...(billerName !== undefined && { billerName }),
    type: 'cable_tv',
  });

beforeEach(() => {
  clearKudaBillItemPriceCacheForTests();
  mockGetBillersByCategory.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('bugfix: a decorated biller name also matched the plain biller', () => {
  beforeEach(() => {
    mockGetBillersByCategory.mockResolvedValue([
      cableBiller('DSTV', 5000),
      cableBiller('DSTV - PREMIUM', 9500),
    ]);
  });

  it('refuses the plain DStv price for a purchase naming DStv Premium', async () => {
    await expect(purchase(5000, 'DSTV - PREMIUM')).rejects.toThrow(
      KUDA_BILL_PRICE_CHANGED_MESSAGE
    );
  });

  it('refuses the plain DStv price when the checkout adds the package path', async () => {
    // Real checkouts send "<biller> - <package path>".
    await expect(
      purchase(5000, 'DSTV - PREMIUM - Shared package')
    ).rejects.toThrow(KUDA_BILL_PRICE_CHANGED_MESSAGE);
    await expect(
      purchase(9500, 'DSTV - PREMIUM - Shared package')
    ).resolves.toBeUndefined();
  });

  it('accepts DStv Premium at its own price', async () => {
    await expect(purchase(9500, 'DSTV - PREMIUM')).resolves.toBeUndefined();
  });

  it('still matches a decorated checkout name to its listed biller', async () => {
    mockGetBillersByCategory.mockResolvedValue([cableBiller('GOTV', 4000)]);

    await expect(
      purchase(4000, 'GOTV - Shared package')
    ).resolves.toBeUndefined();
  });
});

describe('bugfix: with no biller named, one biller confirmed for all', () => {
  it('fails closed when another biller lists the package unreadably', async () => {
    mockGetBillersByCategory.mockResolvedValue([
      cableBiller('DSTV', 9500),
      cableBiller('DSTV NG', 0),
    ]);

    await expect(purchase(9500)).rejects.toThrow(
      KUDA_BILL_PRICE_UNCONFIRMED_MESSAGE
    );
  });

  it('passes when every biller confirms the price', async () => {
    mockGetBillersByCategory.mockResolvedValue([
      cableBiller('DSTV', 9500),
      cableBiller('DSTV NG', 9500),
    ]);

    await expect(purchase(9500)).resolves.toBeUndefined();
  });
});

describe('bugfix: a slow Kuda failure stretched the price-list backup window', () => {
  const T0 = new Date('2026-11-20T10:00:00Z').getTime();
  const DAY = 24 * 60 * 60 * 1000;

  function slowFailure(ms: number) {
    mockGetBillersByCategory.mockImplementationOnce(async () => {
      vi.setSystemTime(Date.now() + ms);
      throw new Error('Kuda GET_BILLERS_BY_TYPE request timed out');
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    mockGetBillersByCategory.mockResolvedValue([cableBiller('DSTV', 9500)]);
  });

  it('refuses a backup list that turns a day old while Kuda is answering', async () => {
    await purchase(9500, 'DSTV');
    vi.setSystemTime(T0 + DAY - 5_000);
    slowFailure(10_000);

    await expect(purchase(9500, 'DSTV')).rejects.toThrow(
      KUDA_BILL_PRICE_UNCONFIRMED_MESSAGE
    );
  });

  it('starts the 30-second pause when the slow failure ends', async () => {
    await purchase(9500, 'DSTV');
    vi.setSystemTime(T0 + 2 * 60_000);
    slowFailure(10_000);
    await purchase(9500, 'DSTV');
    const callsAfterFailure = mockGetBillersByCategory.mock.calls.length;

    vi.setSystemTime(Date.now() + 20_000);
    await purchase(9500, 'DSTV');

    expect(mockGetBillersByCategory).toHaveBeenCalledTimes(callsAfterFailure);
  });
});

describe('bugfix: billers chosen and unreadable listings seen end to end', () => {
  // Real Kuda answers mapped exactly as getBillersByType maps them.
  async function kudaAnswer(
    billers: Array<{ name: string; amount: number | string }>
  ) {
    const { mapKudaBillersAnswer } = await import('./kuda-biller-mapping');
    return mapKudaBillersAnswer(
      {
        billers: billers.map(({ name, amount }) => ({
          id: name,
          name,
          description: 'Cable',
          billTypeId: 'cable',
          billItems: [
            {
              itemCode: 'KUD-CAB-DST-SHARED',
              itemName: 'Shared package',
              amount,
              isFixedPrice: true,
            },
          ],
        })),
      },
      'CableTv'
    ).billers;
  }

  it('fails closed with no biller named when one biller sent a blank price', async () => {
    mockGetBillersByCategory.mockResolvedValue(
      await kudaAnswer([
        { name: 'DSTV', amount: 950000 },
        { name: 'DSTV NG', amount: '' },
      ])
    );

    await expect(purchase(9500)).rejects.toThrow(
      KUDA_BILL_PRICE_UNCONFIRMED_MESSAGE
    );
  });

  it('fails closed for a named biller whose only listing is unreadable', async () => {
    mockGetBillersByCategory.mockResolvedValue(
      await kudaAnswer([
        { name: 'DSTV', amount: 500000 },
        { name: 'DSTV - PREMIUM', amount: 0 },
      ])
    );

    await expect(
      purchase(5000, 'DSTV - PREMIUM - Shared package')
    ).rejects.toThrow(KUDA_BILL_PRICE_UNCONFIRMED_MESSAGE);
  });

  it('fails closed with no biller named when one biller was dropped for unit doubt', async () => {
    // "9500NGN" sent as 9500: that biller's list looks priced in naira.
    const { mapKudaBillersAnswer } = await import('./kuda-biller-mapping');
    const raw = (name: string, amount: number, itemName: string) => ({
      id: name,
      name,
      description: 'Cable',
      billTypeId: 'cable',
      billItems: [
        {
          itemCode: 'KUD-CAB-DST-SHARED',
          itemName,
          amount,
          isFixedPrice: true,
        },
      ],
    });
    mockGetBillersByCategory.mockResolvedValue(
      mapKudaBillersAnswer(
        {
          billers: [
            raw('DSTV', 950000, 'Package'),
            raw('DSTV NG', 9500, 'Package 9500NGN'),
          ],
        },
        'CableTv'
      ).billers
    );

    await expect(purchase(9500)).rejects.toThrow(
      KUDA_BILL_PRICE_UNCONFIRMED_MESSAGE
    );
  });

  it('does not fall back to a shorter biller when the named one stopped listing it', async () => {
    mockGetBillersByCategory.mockResolvedValue([
      cableBiller('DSTV', 5000),
      { ...cableBiller('DSTV - PREMIUM', 9500), billItems: [] },
    ]);

    await expect(
      purchase(5000, 'DSTV - PREMIUM - Shared package')
    ).rejects.toThrow(KUDA_BILL_PRICE_CHANGED_MESSAGE);
  });
});
