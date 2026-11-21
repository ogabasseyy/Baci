import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NetworkProvider } from './kuda';
import { KUDA_BILL_PRICE_UNCONFIRMED_MESSAGE } from './kuda-bill-item-price-messages';
import { mapKudaBillersAnswer } from './kuda-biller-mapping';
import {
  clearKudaDataPlanCacheForTests,
  resolveKudaDataPlanForPurchase,
} from './kuda-data-plans';

type KudaModule = typeof import('./kuda');

const mockGetDataProviders = vi.hoisted(() => vi.fn());

vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn() } }));
vi.mock('./logger', () => ({ logger: { warn: vi.fn() } }));
vi.mock('./kuda', async (importOriginal) => {
  const actual = await importOriginal<KudaModule>();
  return { ...actual, getDataProviders: () => mockGetDataProviders() };
});

/** MTN's plan list as Kuda sends it, mapped like getDataProviders maps it. */
function mtnAnswer(plans: Array<{ code: string; amount: number | string }>) {
  return mapKudaBillersAnswer(
    {
      billers: [
        {
          id: 'mtn',
          name: 'MTN NG DATA',
          description: 'Internet Data',
          billTypeId: 'data',
          billItems: plans.map(({ code, amount }) => ({
            itemCode: code,
            itemName: `Plan ${code}`,
            amount,
            isFixedPrice: true,
          })),
        },
      ],
    },
    'Internet Data'
  ).billers;
}

describe('bugfix: an unreadable provider list let a different plan be sold', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearKudaDataPlanCacheForTests();
  });

  it('fails closed when a request names the provider and one of its plans was dropped', async () => {
    mockGetDataProviders.mockResolvedValue(
      mtnAnswer([
        { code: 'MTN-1GB-MONTHLY', amount: '' },
        { code: 'MTN-1GB-PROMO', amount: 100000 },
      ])
    );

    await expect(
      resolveKudaDataPlanForPurchase({
        amount: 1000,
        dataPlanCode: 'MTN NG DATA',
        networkProvider: NetworkProvider.MTN,
      })
    ).rejects.toThrow(KUDA_BILL_PRICE_UNCONFIRMED_MESSAGE);
  });

  it('fails closed when the network provider sent a malformed plan list', async () => {
    mockGetDataProviders.mockResolvedValue([
      ...mapKudaBillersAnswer(
        {
          billers: [
            {
              id: 'mtn',
              name: 'MTN NG DATA',
              description: 'Internet Data',
              billTypeId: 'data',
              billItems: [
                {
                  itemCode: 'G',
                  itemName: 'G',
                  amount: 0,
                  isFixedPrice: false,
                  billItems: {},
                },
              ],
            },
          ],
        },
        'Internet Data'
      ).billers,
      ...mtnAnswer([{ code: 'MTN-1GB-PROMO', amount: 100000 }]).map(
        (provider) => ({
          ...provider,
          billerId: 'mtn-sme',
          billerName: 'MTN SME DATA',
        })
      ),
    ]);

    await expect(
      resolveKudaDataPlanForPurchase({
        amount: 1000,
        dataPlanCode: 'MTN-1GB-MONTHLY',
        networkProvider: NetworkProvider.MTN,
      })
    ).rejects.toThrow(KUDA_BILL_PRICE_UNCONFIRMED_MESSAGE);
  });

  it('refuses an exact plan from a provider that also sent a malformed group', async () => {
    mockGetDataProviders.mockResolvedValue(
      mapKudaBillersAnswer(
        {
          billers: [
            {
              id: 'mtn',
              name: 'MTN NG DATA',
              description: 'Internet Data',
              billTypeId: 'data',
              billItems: [
                {
                  itemCode: 'MTN-1GB-MONTHLY',
                  itemName: 'Plan',
                  amount: 100000,
                  isFixedPrice: true,
                },
                {
                  itemCode: 'G',
                  itemName: 'G',
                  amount: 0,
                  isFixedPrice: false,
                  billItems: {},
                },
              ],
            },
          ],
        },
        'Internet Data'
      ).billers
    );

    await expect(
      resolveKudaDataPlanForPurchase({
        amount: 1000,
        dataPlanCode: 'MTN-1GB-MONTHLY',
        networkProvider: NetworkProvider.MTN,
      })
    ).rejects.toThrow(KUDA_BILL_PRICE_UNCONFIRMED_MESSAGE);
  });

  it('refuses the amount fallback when the provider sent a fixed plan with no code', async () => {
    mockGetDataProviders.mockResolvedValue(
      mapKudaBillersAnswer(
        {
          billers: [
            {
              id: 'mtn',
              name: 'MTN NG DATA',
              description: 'Internet Data',
              billTypeId: 'data',
              billItems: [
                {
                  itemName: 'Mystery plan',
                  amount: 100000,
                  isFixedPrice: true,
                },
                {
                  itemCode: 'MTN-1GB-PROMO',
                  itemName: 'Promo',
                  amount: 100000,
                  isFixedPrice: true,
                },
              ],
            },
          ],
        },
        'Internet Data'
      ).billers
    );

    await expect(
      resolveKudaDataPlanForPurchase({
        amount: 1000,
        dataPlanCode: 'MTN-1GB-MONTHLY',
        networkProvider: NetworkProvider.MTN,
      })
    ).rejects.toThrow(KUDA_BILL_PRICE_UNCONFIRMED_MESSAGE);
  });

  it('refuses a plan code listed twice when one copy was dropped', async () => {
    mockGetDataProviders.mockResolvedValue(
      mtnAnswer([
        { code: 'MTN-1GB-MONTHLY', amount: 100000 },
        { code: 'MTN-1GB-MONTHLY', amount: '' },
      ])
    );

    await expect(
      resolveKudaDataPlanForPurchase({
        amount: 1000,
        dataPlanCode: 'MTN-1GB-MONTHLY',
        networkProvider: NetworkProvider.MTN,
      })
    ).rejects.toThrow(KUDA_BILL_PRICE_UNCONFIRMED_MESSAGE);
  });

  it("refuses an unknown plan at a readable plan's price when the list has a null entry", async () => {
    mockGetDataProviders.mockResolvedValue(
      mapKudaBillersAnswer(
        {
          billers: [
            {
              id: 'mtn',
              name: 'MTN NG DATA',
              description: 'Internet Data',
              billTypeId: 'data',
              billItems: [
                {
                  itemCode: 'MTN-1GB-PROMO',
                  itemName: 'Promo',
                  amount: 100000,
                  isFixedPrice: true,
                },
                null,
              ],
            },
          ],
        },
        'Internet Data'
      ).billers
    );

    await expect(
      resolveKudaDataPlanForPurchase({
        amount: 1000,
        dataPlanCode: 'MTN-UNKNOWN-PLAN',
        networkProvider: NetworkProvider.MTN,
      })
    ).rejects.toThrow(KUDA_BILL_PRICE_UNCONFIRMED_MESSAGE);
  });
});
