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

function provider(name: string, billItems: unknown[]) {
  return mapKudaBillersAnswer(
    {
      billers: [
        {
          id: name,
          name,
          description: 'Internet Data',
          billTypeId: 'data',
          billItems,
        },
      ],
    },
    'Internet Data'
  ).billers;
}

const readableMtnSme = () =>
  provider('MTN SME DATA', [
    {
      itemCode: 'MTN-1GB-PROMO',
      itemName: '1GB Promo',
      amount: 100000,
      isFixedPrice: true,
    },
  ]);

const malformedMtn = () =>
  provider('MTN NG DATA', [
    {
      itemCode: 'G',
      itemName: 'G',
      amount: 0,
      isFixedPrice: false,
      billItems: {},
    },
  ]);

describe('bugfix: a plan sent with another network skipped its own network’s unreadable lists', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearKudaDataPlanCacheForTests();
  });

  it('refuses an MTN plan sent as GLO when another MTN list is malformed', async () => {
    mockGetDataProviders.mockResolvedValue([
      ...malformedMtn(),
      ...readableMtnSme(),
    ]);

    await expect(
      resolveKudaDataPlanForPurchase({
        amount: 1000,
        dataPlanCode: 'MTN-1GB-PROMO',
        networkProvider: NetworkProvider.GLO,
      })
    ).rejects.toThrow(KUDA_BILL_PRICE_UNCONFIRMED_MESSAGE);
  });

  it('still resolves the MTN plan when every MTN list is readable', async () => {
    mockGetDataProviders.mockResolvedValue(readableMtnSme());

    await expect(
      resolveKudaDataPlanForPurchase({
        amount: 1000,
        dataPlanCode: 'MTN-1GB-PROMO',
        networkProvider: NetworkProvider.MTN,
      })
    ).resolves.toMatchObject({
      itemCode: 'MTN-1GB-PROMO',
      resolvedFrom: 'exact_item_code',
    });
  });
});
