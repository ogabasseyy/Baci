import { describe, expect, it, vi } from 'vitest';

vi.mock('./logger', () => ({ logger: { warn: vi.fn() } }));

import { mapKudaBillersAnswer } from './kuda-biller-mapping';

describe('mapKudaBillersAnswer', () => {
  it('maps camelCase billers with their raw kobo prices', () => {
    const { billers, rawFixedPricesKobo } = mapKudaBillersAnswer(
      {
        billers: [
          {
            id: 'st',
            name: 'STARTIMES NG',
            description: 'Cable',
            billTypeId: 'cable',
            billItems: [
              {
                itemCode: 'SUPER',
                itemName: 'Super',
                amount: 950000,
                isFixedPrice: true,
              },
            ],
          },
        ],
      },
      'CableTv'
    );

    expect(billers).toEqual([
      expect.objectContaining({
        billerId: 'st',
        billerName: 'STARTIMES NG',
        categoryName: 'CableTv',
        billItems: [
          expect.objectContaining({ itemCode: 'SUPER', amount: 9500 }),
        ],
      }),
    ]);
    expect(billers[0]).not.toHaveProperty('unreadableItemCodes');
    expect(rawFixedPricesKobo).toEqual([950000]);
  });

  it('records PascalCase items dropped for an unusable price', () => {
    const { billers } = mapKudaBillersAnswer(
      {
        Billers: [
          {
            Id: 'dstv',
            Name: 'DSTV',
            Description: 'Cable',
            BillTypeId: 'cable',
            BillItems: [
              {
                ItemCode: 'BLANK',
                ItemName: 'Blank',
                Amount: '',
                IsAmountFixed: true,
              },
            ],
          },
        ],
      },
      'CableTv'
    );

    expect(billers[0]?.billItems).toBeUndefined();
    expect(billers[0]?.unreadableItemCodes).toEqual(['BLANK']);
  });

  it('returns nothing for an empty answer', () => {
    expect(mapKudaBillersAnswer({}, 'CableTv')).toEqual({
      billers: [],
      rawFixedPricesKobo: [],
    });
  });
});
