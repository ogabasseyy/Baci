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

describe('bugfix: a dropped data plan fell back to another plan at the same price', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearKudaDataPlanCacheForTests();
  });

  it.each([
    '',
    0,
    '0.00',
  ])('fails closed when the selected plan was sent priced %j', async (amount) => {
    mockGetDataProviders.mockResolvedValue(
      mtnAnswer([
        { code: 'MTN-1GB-MONTHLY', amount },
        { code: 'MTN-1GB-PROMO', amount: 100000 },
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

  it('still resolves a readable plan by its exact code', async () => {
    mockGetDataProviders.mockResolvedValue(
      mtnAnswer([
        { code: 'MTN-1GB-MONTHLY', amount: '' },
        { code: 'MTN-1GB-PROMO', amount: 100000 },
      ])
    );

    await expect(
      resolveKudaDataPlanForPurchase({
        amount: 1000,
        dataPlanCode: 'MTN-1GB-PROMO',
        networkProvider: NetworkProvider.MTN,
      })
    ).resolves.toMatchObject({ itemCode: 'MTN-1GB-PROMO' });
  });

  it('refuses the saved price after a fresh answer marks the plan unreadable', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-20T10:00:00Z'));
    mockGetDataProviders.mockResolvedValue(
      mtnAnswer([{ code: 'MTN-1GB-MONTHLY', amount: 100000 }])
    );
    const buy = () =>
      resolveKudaDataPlanForPurchase({
        amount: 1000,
        dataPlanCode: 'MTN-1GB-MONTHLY',
        networkProvider: NetworkProvider.MTN,
      });
    await buy();

    vi.setSystemTime(new Date('2026-11-20T10:02:00Z'));
    mockGetDataProviders.mockResolvedValue(
      mtnAnswer([{ code: 'MTN-1GB-MONTHLY', amount: '' }])
    );

    await expect(buy()).rejects.toThrow(KUDA_BILL_PRICE_UNCONFIRMED_MESSAGE);
    vi.useRealTimers();
  });

  it('refuses the saved plan when a provider the saved list lacks marks it unreadable', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-20T10:00:00Z'));
    mockGetDataProviders.mockResolvedValue(
      mtnAnswer([{ code: 'MTN-1GB-MONTHLY', amount: 100000 }])
    );
    const buy = () =>
      resolveKudaDataPlanForPurchase({
        amount: 1000,
        dataPlanCode: 'MTN-1GB-MONTHLY',
        networkProvider: NetworkProvider.MTN,
      });
    await buy();

    vi.setSystemTime(new Date('2026-11-20T10:02:00Z'));
    mockGetDataProviders.mockResolvedValue(
      mapKudaBillersAnswer(
        {
          billers: [
            {
              id: 'mtn-2',
              name: 'MTN DATA BUNDLES',
              description: 'Internet Data',
              billTypeId: 'data',
              billItems: [
                {
                  itemCode: 'MTN-1GB-MONTHLY',
                  itemName: 'Plan',
                  amount: '',
                  isFixedPrice: true,
                },
              ],
            },
          ],
        },
        'Internet Data'
      ).billers
    );

    await expect(buy()).rejects.toThrow(KUDA_BILL_PRICE_UNCONFIRMED_MESSAGE);
    vi.useRealTimers();
  });
});
