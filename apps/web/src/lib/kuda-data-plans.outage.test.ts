import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NetworkProvider } from './kuda';
import { KUDA_BILL_PRICE_UNCONFIRMED_MESSAGE } from './kuda-bill-item-price-messages';
import {
  clearKudaDataPlanCacheForTests,
  resolveKudaDataPlanForPurchase,
} from './kuda-data-plans';

type KudaModule = typeof import('./kuda');

const mockGetDataProviders = vi.hoisted(() => vi.fn());
const mockLoggerWarn = vi.hoisted(() => vi.fn());

vi.mock('@/lib/logger', () => ({
  logger: { warn: (...args: unknown[]) => mockLoggerWarn(...args) },
}));

vi.mock('./kuda', async (importOriginal) => {
  const actual = await importOriginal<KudaModule>();
  return {
    ...actual,
    getDataProviders: () => mockGetDataProviders(),
  };
});

describe('resolveKudaDataPlanForPurchase when Kuda is unavailable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearKudaDataPlanCacheForTests();
    mockGetDataProviders.mockResolvedValue([
      {
        billerId: '2082751a-89c7-4862-86c5-5498194b32f3',
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
          {
            amount: 3500,
            isAmountFixed: true,
            itemCode: 'MTN-35GB-MONTHLY',
            itemCurrencySymbol: 'NGN',
            itemFee: 0,
            itemName: 'MTN 3.5GB Monthly',
          },
        ],
      },
    ]);
  });
  describe('bugfix: a saved 100x data price was trusted when Kuda was down', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it.each([
      [
        'fails',
        () =>
          mockGetDataProviders.mockRejectedValueOnce(new Error('Kuda timeout')),
      ],
      ['is empty', () => mockGetDataProviders.mockResolvedValueOnce([])],
    ])('fails closed with no recent plan list when Kuda %s', async (_label, breakKuda) => {
      breakKuda();

      await expect(
        resolveKudaDataPlanForPurchase({
          amount: 350000,
          dataPlanCode: 'MTN-35GB-MONTHLY',
          networkProvider: NetworkProvider.MTN,
        })
      ).rejects.toThrow(KUDA_BILL_PRICE_UNCONFIRMED_MESSAGE);
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        expect.objectContaining({ hasLastGoodList: false, type: 'data' })
      );
    });

    it('fails closed when Kuda answers with billers but no packages', async () => {
      mockGetDataProviders.mockResolvedValueOnce([
        {
          billerId: 'mtn',
          billerName: 'MTN',
          billerType: 'Internet Data',
          categoryId: 'data',
          categoryName: 'Internet Data',
          billItems: [],
        },
      ]);

      await expect(
        resolveKudaDataPlanForPurchase({
          amount: 350000,
          dataPlanCode: 'MTN-35GB-MONTHLY',
          networkProvider: NetworkProvider.MTN,
        })
      ).rejects.toThrow(KUDA_BILL_PRICE_UNCONFIRMED_MESSAGE);
    });

    it('never replaces a good plan list with one that has no packages', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-11-17T10:00:00Z'));
      await resolveKudaDataPlanForPurchase({
        amount: 3500,
        dataPlanCode: 'MTN-35GB-MONTHLY',
        networkProvider: NetworkProvider.MTN,
      });
      vi.setSystemTime(new Date('2026-11-17T10:05:00Z'));
      mockGetDataProviders.mockResolvedValue([
        { billerId: 'mtn', billerName: 'MTN', billItems: [] },
      ]);

      await expect(
        resolveKudaDataPlanForPurchase({
          amount: 3500,
          dataPlanCode: 'MTN-35GB-MONTHLY',
          networkProvider: NetworkProvider.MTN,
        })
      ).resolves.toMatchObject({ amount: 3500 });
    });

    it('waits 30 seconds before asking Kuda again after a failure', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-11-17T10:00:00Z'));
      mockGetDataProviders.mockRejectedValue(new Error('Kuda timeout'));
      const purchase = {
        amount: 3500,
        dataPlanCode: 'MTN-35GB-MONTHLY',
        networkProvider: NetworkProvider.MTN,
      };
      await expect(resolveKudaDataPlanForPurchase(purchase)).rejects.toThrow();
      await expect(resolveKudaDataPlanForPurchase(purchase)).rejects.toThrow();
      expect(mockGetDataProviders).toHaveBeenCalledTimes(1);
    });

    it('cannot confirm an implausibly low fixed plan price', async () => {
      mockGetDataProviders.mockResolvedValueOnce([
        {
          billerId: 'mtn',
          billerName: 'MTN',
          billerType: 'Internet Data',
          categoryId: 'data',
          categoryName: 'Internet Data',
          billItems: [
            {
              amount: 5,
              isAmountFixed: true,
              itemCode: 'MTN-35GB-MONTHLY',
              itemCurrencySymbol: 'NGN',
              itemFee: 0,
              itemName: 'MTN 3.5GB Monthly',
            },
          ],
        },
      ]);

      await expect(
        resolveKudaDataPlanForPurchase({
          amount: 5,
          dataPlanCode: 'MTN-35GB-MONTHLY',
          networkProvider: NetworkProvider.MTN,
        })
      ).rejects.toThrow(KUDA_BILL_PRICE_UNCONFIRMED_MESSAGE);
    });

    it('keeps rejecting stale prices with the last good plan list', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-11-17T10:00:00Z'));
      await resolveKudaDataPlanForPurchase({
        amount: 3500,
        dataPlanCode: 'MTN-35GB-MONTHLY',
        networkProvider: NetworkProvider.MTN,
      });
      vi.setSystemTime(new Date('2026-11-17T12:00:00Z'));
      mockGetDataProviders.mockRejectedValue(new Error('Kuda timeout'));

      await expect(
        resolveKudaDataPlanForPurchase({
          amount: 350000,
          dataPlanCode: 'MTN-35GB-MONTHLY',
          networkProvider: NetworkProvider.MTN,
        })
      ).rejects.toThrow('Data bundle amount changed');
      await expect(
        resolveKudaDataPlanForPurchase({
          amount: 3500,
          dataPlanCode: 'MTN-35GB-MONTHLY',
          networkProvider: NetworkProvider.MTN,
        })
      ).resolves.toMatchObject({ amount: 3500 });
    });
  });
});
