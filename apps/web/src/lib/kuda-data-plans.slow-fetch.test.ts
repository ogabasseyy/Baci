import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NetworkProvider } from './kuda';
import { KUDA_BILL_PRICE_UNCONFIRMED_MESSAGE } from './kuda-bill-item-price-messages';
import {
  clearKudaDataPlanCacheForTests,
  resolveKudaDataPlanForPurchase,
} from './kuda-data-plans';

type KudaModule = typeof import('./kuda');

const mockGetDataProviders = vi.hoisted(() => vi.fn());

vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn() } }));

vi.mock('./kuda', async (importOriginal) => {
  const actual = await importOriginal<KudaModule>();
  return { ...actual, getDataProviders: () => mockGetDataProviders() };
});

const T0 = new Date('2026-11-20T10:00:00Z').getTime();
const DAY = 24 * 60 * 60 * 1000;

const mtn = [
  {
    billerId: 'mtn',
    billerName: 'MTN',
    billerType: 'Internet Data',
    categoryId: 'data',
    categoryName: 'Internet Data',
    billItems: [
      {
        amount: 1000,
        isAmountFixed: true,
        itemCode: 'MTN-1GB-MONTHLY',
        itemCurrencySymbol: 'NGN',
        itemFee: 0,
        itemName: 'MTN 1GB Monthly',
      },
    ],
  },
];

const purchase = () =>
  resolveKudaDataPlanForPurchase({
    amount: 1000,
    dataPlanCode: 'MTN-1GB-MONTHLY',
    networkProvider: NetworkProvider.MTN,
  });

/** Kuda takes `ms` to answer, then fails. */
function slowFailure(ms: number) {
  mockGetDataProviders.mockImplementationOnce(async () => {
    vi.setSystemTime(Date.now() + ms);
    throw new Error('Kuda GET_BILLERS_BY_TYPE request timed out');
  });
}

describe('bugfix: a slow Kuda failure stretched the data-plan backup window', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearKudaDataPlanCacheForTests();
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    mockGetDataProviders.mockResolvedValue(mtn);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('refuses a backup list that turns a day old while Kuda is answering', async () => {
    await purchase();
    vi.setSystemTime(T0 + DAY - 5_000);
    slowFailure(10_000);

    await expect(purchase()).rejects.toThrow(
      KUDA_BILL_PRICE_UNCONFIRMED_MESSAGE
    );
  });

  it('still uses a backup list that stays under a day old', async () => {
    await purchase();
    vi.setSystemTime(T0 + DAY - 60_000);
    slowFailure(10_000);

    await expect(purchase()).resolves.toMatchObject({
      itemCode: 'MTN-1GB-MONTHLY',
    });
  });

  it('starts the 30-second pause when the slow failure ends', async () => {
    await purchase();
    vi.setSystemTime(T0 + 2 * 60_000);
    slowFailure(10_000);
    await purchase();
    const callsAfterFailure = mockGetDataProviders.mock.calls.length;

    // 20 s after the failure ended (30 s after the call began).
    vi.setSystemTime(Date.now() + 20_000);
    await purchase();

    expect(mockGetDataProviders).toHaveBeenCalledTimes(callsAfterFailure);
  });

  it('dates a slow successful list from when Kuda answered', async () => {
    mockGetDataProviders.mockImplementationOnce(async () => {
      vi.setSystemTime(Date.now() + 10_000);
      return mtn;
    });
    await purchase();
    // A day after the call began, but under a day after Kuda answered.
    vi.setSystemTime(T0 + DAY + 5_000);
    mockGetDataProviders.mockRejectedValueOnce(
      new Error('Kuda GET_BILLERS_BY_TYPE request timed out')
    );

    await expect(purchase()).resolves.toMatchObject({
      itemCode: 'MTN-1GB-MONTHLY',
    });
  });
});
