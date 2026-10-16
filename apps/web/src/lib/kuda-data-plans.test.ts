import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NetworkProvider } from './kuda';
import {
  clearKudaDataPlanCacheForTests,
  resolveKudaDataPlanForPurchase,
} from './kuda-data-plans';

type KudaModule = typeof import('./kuda');

const mockGetDataProviders = vi.hoisted(() => vi.fn());

vi.mock('./kuda', async (importOriginal) => {
  const actual = await importOriginal<KudaModule>();
  return {
    ...actual,
    getDataProviders: () => mockGetDataProviders(),
  };
});

describe('resolveKudaDataPlanForPurchase', () => {
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

  it('preserves a selected Kuda data package item code', async () => {
    await expect(
      resolveKudaDataPlanForPurchase({
        amount: 3500,
        dataPlanCode: 'MTN-35GB-MONTHLY',
        networkProvider: NetworkProvider.MTN,
      })
    ).resolves.toMatchObject({
      itemCode: 'MTN-35GB-MONTHLY',
      itemName: 'MTN 3.5GB Monthly',
      providerName: 'MTN',
    });
  });

  it('keeps the submitted package code when provider refresh fails', async () => {
    mockGetDataProviders.mockRejectedValueOnce(new Error('Kuda timeout'));

    await expect(
      resolveKudaDataPlanForPurchase({
        amount: 3500,
        dataPlanCode: 'MTN-35GB-MONTHLY',
        networkProvider: NetworkProvider.MTN,
      })
    ).resolves.toMatchObject({
      amount: 3500,
      itemCode: 'MTN-35GB-MONTHLY',
      originalDataPlanCode: 'MTN-35GB-MONTHLY',
      providerName: 'MTN',
      resolvedFrom: 'exact_item_code',
    });
  });

  it('keeps provider-level data plans when the selected provider has no nested items', async () => {
    mockGetDataProviders.mockResolvedValueOnce([
      {
        billerId: '2082751a-89c7-4862-86c5-5498194b32f3',
        billerName: 'MTN',
        billerType: 'Internet Data',
        categoryId: 'data',
        categoryName: 'Internet Data',
      },
      {
        billerId: 'airtel-data',
        billerName: 'Airtel',
        billerType: 'Internet Data',
        categoryId: 'data',
        categoryName: 'Internet Data',
        billItems: [
          {
            amount: 2000,
            isAmountFixed: true,
            itemCode: 'AIRTEL-2GB',
            itemCurrencySymbol: 'NGN',
            itemFee: 0,
            itemName: 'Airtel 2GB',
          },
        ],
      },
    ]);

    await expect(
      resolveKudaDataPlanForPurchase({
        amount: 1000,
        dataPlanCode: '2082751a-89c7-4862-86c5-5498194b32f3',
        networkProvider: NetworkProvider.MTN,
      })
    ).resolves.toMatchObject({
      amount: 1000,
      itemCode: '2082751a-89c7-4862-86c5-5498194b32f3',
      providerName: 'MTN',
      resolvedFrom: 'exact_item_code',
    });
  });

  it('rejects stale amounts for exact fixed-price package codes', async () => {
    await expect(
      resolveKudaDataPlanForPurchase({
        amount: 3000,
        dataPlanCode: 'MTN-35GB-MONTHLY',
        networkProvider: NetworkProvider.MTN,
      })
    ).rejects.toThrow(
      'Data bundle amount changed for MTN 3.5GB Monthly. Please refresh data bundles and select a package.'
    );
  });

  it('keeps the submitted amount for exact variable-price package codes', async () => {
    mockGetDataProviders.mockResolvedValueOnce([
      {
        billerId: 'mtn-data',
        billerName: 'MTN',
        billerType: 'Internet Data',
        categoryId: 'data',
        categoryName: 'Internet Data',
        billItems: [
          {
            amount: 0,
            isAmountFixed: false,
            itemCode: 'MTN-VARIABLE',
            itemCurrencySymbol: 'NGN',
            itemFee: 0,
            itemName: 'MTN Variable Data',
          },
        ],
      },
    ]);

    await expect(
      resolveKudaDataPlanForPurchase({
        amount: 2500,
        dataPlanCode: 'MTN-VARIABLE',
        networkProvider: NetworkProvider.MTN,
      })
    ).resolves.toMatchObject({
      amount: 2500,
      itemCode: 'MTN-VARIABLE',
      providerName: 'MTN',
      resolvedFrom: 'exact_item_code',
    });
  });

  it('maps a legacy provider UUID plus amount to the matching Kuda package item code', async () => {
    await expect(
      resolveKudaDataPlanForPurchase({
        amount: 3500,
        dataPlanCode: '2082751a-89c7-4862-86c5-5498194b32f3',
        networkProvider: NetworkProvider.MTN,
      })
    ).resolves.toMatchObject({
      itemCode: 'MTN-35GB-MONTHLY',
      itemName: 'MTN 3.5GB Monthly',
      originalDataPlanCode: '2082751a-89c7-4862-86c5-5498194b32f3',
      providerName: 'MTN',
      resolvedFrom: 'provider_amount',
    });
  });

  it('fails before checkout when a provider UUID amount no longer maps to a package', async () => {
    await expect(
      resolveKudaDataPlanForPurchase({
        amount: 9999,
        dataPlanCode: '2082751a-89c7-4862-86c5-5498194b32f3',
        networkProvider: NetworkProvider.MTN,
      })
    ).rejects.toThrow(
      'Data bundle not found for MTN at ₦9,999. Please refresh data bundles and select a package.'
    );
  });
});
