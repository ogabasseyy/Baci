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

  it('records items dropped because their list looks priced in naira', () => {
    const { billers } = mapKudaBillersAnswer(
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
                itemName: 'DTT SUPER MONTHLY 9500NGN',
                amount: 9500,
                isFixedPrice: true,
              },
              {
                itemCode: 'OPEN',
                itemName: 'Top up',
                amount: 0,
                isFixedPrice: false,
              },
            ],
          },
        ],
      },
      'CableTv'
    );

    expect(billers[0]?.billItems?.map((item) => item.itemCode)).toEqual([
      'OPEN',
    ]);
    expect(billers[0]?.unreadableItemCodes).toEqual(['SUPER']);
  });

  it('never marks readable copies whose code differs only by case or spaces', () => {
    const { billers } = mapKudaBillersAnswer(
      {
        billers: [
          {
            id: 'st',
            name: 'STARTIMES NG',
            description: 'Cable',
            billTypeId: 'cable',
            billItems: [
              {
                itemCode: 'kud-cab-1',
                itemName: 'Basic',
                amount: 500000,
                isFixedPrice: true,
              },
              {
                itemCode: 'KUD-CAB-1 ',
                itemName: 'Basic',
                amount: 600000,
                isFixedPrice: true,
              },
            ],
          },
        ],
      },
      'CableTv'
    );

    expect(billers[0]).not.toHaveProperty('unreadableItemCodes');
  });

  it('marks a biller whose package list is not a list', () => {
    const { billers } = mapKudaBillersAnswer(
      {
        billers: [
          {
            id: 'x',
            name: 'X',
            description: 'Cable',
            billTypeId: 'cable',
            billItems: {},
          },
        ],
      },
      'CableTv'
    );

    expect(billers[0]?.packagesUnreadable).toBe(true);
    expect(billers[0]?.billItems).toBeUndefined();
  });

  it('marks a code listed twice when only one copy was dropped', () => {
    const { billers } = mapKudaBillersAnswer(
      {
        billers: [
          {
            id: 'st',
            name: 'STARTIMES NG',
            description: 'Cable',
            billTypeId: 'cable',
            billItems: [
              {
                itemCode: 'DUP',
                itemName: 'Basic',
                amount: 500000,
                isFixedPrice: true,
              },
              {
                itemCode: 'DUP',
                itemName: 'Basic',
                amount: '',
                isFixedPrice: true,
              },
            ],
          },
        ],
      },
      'CableTv'
    );

    expect(billers[0]?.unreadableItemCodes).toEqual(['DUP']);
  });
});
