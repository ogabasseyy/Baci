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
import { KUDA_BILL_PRICE_CHANGED_MESSAGE } from './kuda-bill-item-price-messages';
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

describe('bugfix: a decorated name fell back to a shorter biller that was still listed', () => {
  it('refuses when the named biller is gone and only the shorter one lists the code', async () => {
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
                  itemName: 'Compact',
                  amount: 500000,
                  isFixedPrice: true,
                },
              ],
            },
          ],
        },
        'CableTv'
      ).billers
    );

    // The app sent the Premium biller's package path; Premium is no longer
    // listed, so DSTV's own price must not stand in.
    await expect(purchase(5000, 'DSTV - PREMIUM - Monthly')).rejects.toThrow(
      KUDA_BILL_PRICE_CHANGED_MESSAGE
    );
    // The real DSTV path still works.
    await expect(purchase(5000, 'DSTV - Compact')).resolves.toBeUndefined();
  });
});
