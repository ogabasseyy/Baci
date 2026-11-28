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
import { KUDA_BILL_PRICE_UNCONFIRMED_MESSAGE } from './kuda-bill-item-price-messages';
import { mapKudaBillersAnswer } from './kuda-biller-mapping';

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

describe('bugfix: the saved list confirmed a package Kuda just marked unreadable', () => {
  const T0 = new Date('2026-11-20T10:00:00Z').getTime();

  afterEach(() => {
    vi.useRealTimers();
  });

  it('refuses the saved price after a fresh answer marks the package unreadable', async () => {
    const answer = (amount: number | string) =>
      mapKudaBillersAnswer(
        {
          billers: [
            {
              id: 'dstv',
              name: 'DSTV',
              description: 'Cable',
              billTypeId: 'cable',
              billItems: [
                {
                  itemCode: 'KUD-CAB-DST-SHARED',
                  itemName: 'Package',
                  amount,
                  isFixedPrice: true,
                },
              ],
            },
          ],
        },
        'CableTv'
      ).billers;
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    mockGetBillersByCategory.mockResolvedValue(answer(950000));
    await purchase(9500, 'DSTV');

    vi.setSystemTime(T0 + 2 * 60_000);
    mockGetBillersByCategory.mockResolvedValue(answer(0));

    await expect(purchase(9500, 'DSTV')).rejects.toThrow(
      KUDA_BILL_PRICE_UNCONFIRMED_MESSAGE
    );
    // Still refused from the corrected saved list while Kuda isn't re-asked.
    vi.setSystemTime(T0 + 2 * 60_000 + 10_000);
    await expect(purchase(9500, 'DSTV')).rejects.toThrow(
      KUDA_BILL_PRICE_UNCONFIRMED_MESSAGE
    );
  });
});

describe('bugfix: an unreadable mark under a biller the saved list lacks was ignored', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('refuses an unnamed purchase priced only by another saved biller', async () => {
    const raw = (id: string, amount: number | string) => ({
      id,
      name: id.toUpperCase(),
      description: 'Cable',
      billTypeId: 'cable',
      billItems: [
        {
          itemCode: 'KUD-CAB-DST-SHARED',
          itemName: 'Package',
          amount,
          isFixedPrice: true,
        },
      ],
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-20T10:00:00Z'));
    mockGetBillersByCategory.mockResolvedValue(
      mapKudaBillersAnswer({ billers: [raw('dstv', 950000)] }, 'CableTv')
        .billers
    );
    await purchase(9500);

    vi.setSystemTime(new Date('2026-11-20T10:02:00Z'));
    mockGetBillersByCategory.mockResolvedValue(
      mapKudaBillersAnswer({ billers: [raw('newco', '')] }, 'CableTv').billers
    );

    await expect(purchase(9500)).rejects.toThrow(
      KUDA_BILL_PRICE_UNCONFIRMED_MESSAGE
    );
  });
});

describe('bugfix: a malformed package list kept the saved prices confirmable', () => {
  it('refuses the saved price after a fresh answer sends a malformed list', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-20T10:00:00Z'));
    const dstv = (billItems: unknown) => ({
      id: 'dstv',
      name: 'DSTV',
      description: 'Cable',
      billTypeId: 'cable',
      billItems,
    });
    mockGetBillersByCategory.mockResolvedValue(
      mapKudaBillersAnswer(
        {
          billers: [
            dstv([
              {
                itemCode: 'KUD-CAB-DST-SHARED',
                itemName: 'Package',
                amount: 950000,
                isFixedPrice: true,
              },
            ]),
          ],
        },
        'CableTv'
      ).billers
    );
    await purchase(9500, 'DSTV');

    vi.setSystemTime(new Date('2026-11-20T10:02:00Z'));
    mockGetBillersByCategory.mockResolvedValue(
      mapKudaBillersAnswer({ billers: [dstv({})] }, 'CableTv').billers
    );

    await expect(purchase(9500, 'DSTV')).rejects.toThrow();
    await expect(purchase(9500)).rejects.toThrow(
      KUDA_BILL_PRICE_UNCONFIRMED_MESSAGE
    );
  });
});

describe('bugfix: a biller with a malformed package list still confirmed a readable price', () => {
  it('refuses a named purchase when the biller also sent a malformed group', async () => {
    mockGetBillersByCategory.mockResolvedValue(
      mapKudaBillersAnswer(
        {
          billers: [
            {
              id: 'dstv',
              name: 'DSTV',
              description: 'Cable',
              billTypeId: 'cable',
              billItems: [
                {
                  itemCode: 'KUD-CAB-DST-SHARED',
                  itemName: 'Package',
                  amount: 950000,
                  isFixedPrice: true,
                },
                {
                  itemCode: 'GROUP',
                  itemName: 'Group',
                  amount: 0,
                  isFixedPrice: false,
                  billItems: {},
                },
              ],
            },
          ],
        },
        'CableTv'
      ).billers
    );

    await expect(purchase(9500, 'DSTV')).rejects.toThrow(
      KUDA_BILL_PRICE_UNCONFIRMED_MESSAGE
    );
  });

  it('still lets an electricity meter top-up through for such a biller', async () => {
    mockGetBillersByCategory.mockResolvedValue(
      mapKudaBillersAnswer(
        {
          billers: [
            {
              id: 'ekedc',
              name: 'EKEDC',
              description: 'Electricity',
              billTypeId: 'electricity',
              billItems: {},
            },
            {
              id: 'aedc',
              name: 'AEDC',
              description: 'Electricity',
              billTypeId: 'electricity',
              billItems: [
                {
                  itemCode: 'KUD-ELE-AEDC-FIXED-5000',
                  itemName: 'AEDC fixed top-up',
                  amount: 500000,
                  isFixedPrice: true,
                },
              ],
            },
          ],
        },
        'Electricity'
      ).billers
    );

    await expect(
      assertKudaBillItemPriceCurrent({
        amount: 5000,
        billItemIdentifier: 'KUD-ELE-EKED-002',
        billerName: 'EKEDC',
        type: 'electricity',
      })
    ).resolves.toBeUndefined();
  });
});

describe('bugfix: a duplicate code with one unreadable copy still confirmed', () => {
  it('refuses the readable copy when another copy of the code was dropped', async () => {
    const pkg = (amount: number | string) => ({
      itemCode: 'KUD-CAB-DST-SHARED',
      itemName: 'Package',
      amount,
      isFixedPrice: true,
    });
    mockGetBillersByCategory.mockResolvedValue(
      mapKudaBillersAnswer(
        {
          billers: [
            {
              id: 'dstv',
              name: 'DSTV',
              description: 'Cable',
              billTypeId: 'cable',
              billItems: [pkg(950000), pkg('')],
            },
          ],
        },
        'CableTv'
      ).billers
    );

    await expect(purchase(9500, 'DSTV')).rejects.toThrow(
      KUDA_BILL_PRICE_UNCONFIRMED_MESSAGE
    );
  });
});
