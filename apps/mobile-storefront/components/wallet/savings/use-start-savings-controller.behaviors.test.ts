import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import type { Product } from '@/types/product';
import { useStartSavingsController } from './use-start-savings-controller';

const mockUseLocalSearchParams = jest.fn();
const mockUseProducts = jest.fn();
const mockUseWallet = jest.fn();
const mockRefetch = jest.fn();
const mockSubmitSavingsGoal = jest.fn<() => Promise<void>>();
const mockSetPaymentMethodsError = jest.fn();

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockUseLocalSearchParams(),
}));

jest.mock('@/hooks/use-debounce', () => ({
  useDebounce: (value: string) => value,
}));

jest.mock('@/hooks/use-product-search', () => ({
  useProductSearch: (...args: unknown[]) => mockUseProducts(...args),
}));

jest.mock('@/hooks/use-wallet', () => ({
  useWallet: () => mockUseWallet(),
}));

function walletData(balance = 200000, earningsBalance: number | null = null) {
  return {
    data: {
      wallet: {
        balance,
        earnings_available: earningsBalance !== null,
        earnings_balance: earningsBalance,
        funding_account: {
          account_number: '0123456789',
          bank_name: 'Titan Paystack',
          provider: 'paystack',
        },
      },
    },
    isRefetching: false,
    refetch: mockRefetch,
  };
}

jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (state: { merchantId: string | null }) => unknown) =>
    selector({ merchantId: 'merchant-1' }),
}));

jest.mock('./use-start-savings-payment-methods', () => ({
  useStartSavingsPaymentMethods: () => ({
    isLoadingPaymentMethods: false,
    paymentMethodsError: null,
    savedPaymentMethods: [],
    selectedPaymentMethodId: null,
    setPaymentMethodsError: mockSetPaymentMethodsError,
    setSelectedPaymentMethodId: jest.fn(),
  }),
}));

jest.mock('./use-start-savings-submit', () => ({
  useStartSavingsSubmit: () => ({
    goToWallet: jest.fn(),
    handleAuthorizeSavingsCard: jest.fn(),
    handleCopyFundingAccount: jest.fn(),
    isAuthorizingCard: false,
    isSubmitting: false,
    openWalletFundingScreen: jest.fn(),
    submitSavingsGoal: mockSubmitSavingsGoal,
  }),
}));

const product: Product = {
  id: 'product-1',
  image: 'https://example.com/iphone.jpg',
  name: 'iPhone 13 Pro Max',
  price: 800000,
  slug: 'iphone-13-pro-max',
};

describe('useStartSavingsController', () => {
  it('rejects auto debit in hosted staging even when called outside the selector', () => {
    const previousValue = process.env.EXPO_PUBLIC_HOSTED_STOREFRONT;
    process.env.EXPO_PUBLIC_HOSTED_STOREFRONT = '1';
    try {
      const { result } = renderHook(() => useStartSavingsController());
      act(() => result.current.handleSourceModeChange('auto_debit'));
      expect(result.current.sourceMode).toBe('manual');
      expect(result.current.formError).toBe(
        'Auto debit is not available in this staging build.'
      );
    } finally {
      if (previousValue === undefined)
        delete process.env.EXPO_PUBLIC_HOSTED_STOREFRONT;
      else process.env.EXPO_PUBLIC_HOSTED_STOREFRONT = previousValue;
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseLocalSearchParams.mockReturnValue({});
    mockUseProducts.mockReturnValue({
      isLoading: false,
      products: [product],
    });
    mockUseWallet.mockReturnValue(walletData());
    mockSubmitSavingsGoal.mockResolvedValue(undefined);
  });

  it('validates required fields before opening the preview', () => {
    const { result } = renderHook(() => useStartSavingsController());

    act(() => {
      result.current.handleContinue();
    });

    expect(result.current.formError).toBe(
      'Select the product you want to save for.'
    );
    expect(result.current.showPreviewModal).toBe(false);
  });

  it('opens preview for a complete manual savings form', () => {
    const { result } = renderHook(() => useStartSavingsController());

    act(() => {
      result.current.selectProduct(product);
      result.current.setContributionAmount('20000');
      result.current.setAcceptsNonWithdrawableTerms(true);
    });
    act(() => {
      result.current.handleContinue();
    });

    expect(result.current.formError).toBeNull();
    expect(result.current.showPreviewModal).toBe(true);
    expect(result.current.targetValue).toBe(800000);
  });

  it('selects a searched product and copies its price into the target amount', () => {
    const { result } = renderHook(() => useStartSavingsController());

    act(() => {
      result.current.setSearchValue('iphone');
      result.current.selectProduct(product);
    });

    expect(result.current.searchValue).toBe('iPhone 13 Pro Max');
    expect(result.current.selectedProduct).toEqual(
      expect.objectContaining({
        id: 'product-1',
        name: 'iPhone 13 Pro Max',
      })
    );
    expect(result.current.targetAmount).toBe('800000');
  });

  it('switches the savings target when variant options resolve a variant', () => {
    const variantProduct: Product = {
      ...product,
      variants: [
        {
          attributes: { storage: '128GB' },
          id: 'variant-128',
          name: 'iPhone 13 Pro Max 128GB',
          price: 800000,
        },
        {
          attributes: { storage: '256GB' },
          id: 'variant-256',
          name: 'iPhone 13 Pro Max 256GB',
          price: 850000,
        },
      ],
    };
    mockUseProducts.mockReturnValue({
      isLoading: false,
      products: [variantProduct],
    });
    const { result } = renderHook(() => useStartSavingsController());

    act(() => {
      result.current.selectProduct(variantProduct);
    });
    expect(result.current.selectedProduct?.variantId).toBeNull();
    expect(result.current.targetAmount).toBe('');
    expect(
      result.current.variantOptionGroups.map((group) => group.key)
    ).toEqual(['storage']);

    act(() => {
      result.current.selectVariantOption('storage', '256GB');
    });
    expect(result.current.selectedProduct).toEqual(
      expect.objectContaining({
        price: 850000,
        variantId: 'variant-256',
        variantLabel: 'Storage: 256GB',
      })
    );
    expect(result.current.targetAmount).toBe('850000');
  });

  it('auto-selects the lone variant of single-variant products', () => {
    const singleVariantProduct: Product = {
      ...product,
      variants: [
        {
          attributes: { storage: '128GB' },
          id: 'variant-only',
          name: 'iPhone 13 Pro Max 128GB',
          price: 810000,
        },
      ],
    };
    mockUseProducts.mockReturnValue({
      isLoading: false,
      products: [singleVariantProduct],
    });
    const { result } = renderHook(() => useStartSavingsController());

    act(() => {
      result.current.selectProduct(singleVariantProduct);
    });

    expect(result.current.selectedProduct?.variantId).toBe('variant-only');
    expect(result.current.targetAmount).toBe('810000');
    expect(result.current.variantOptionGroups).toEqual([]);
  });

  it('resets the variant when another product is chosen', () => {
    const variantProduct: Product = {
      ...product,
      id: 'product-2',
      variants: [
        {
          attributes: { storage: '256GB' },
          id: 'variant-256',
          name: 'iPhone 13 Pro Max 256GB',
          price: 850000,
        },
      ],
    };
    mockUseProducts.mockReturnValue({
      isLoading: false,
      products: [variantProduct, product],
    });
    const { result } = renderHook(() => useStartSavingsController());

    act(() => {
      result.current.selectProduct(variantProduct);
    });
    expect(result.current.selectedProduct?.variantId).toBe('variant-256');

    act(() => {
      result.current.selectProduct(product);
    });
    expect(result.current.selectedProduct).toEqual(
      expect.objectContaining({
        id: 'product-1',
        price: 800000,
        variantId: null,
      })
    );
    expect(result.current.targetAmount).toBe('800000');
    expect(result.current.variantOptionGroups).toEqual([]);
  });

  it('clears the selection when the search text diverges from the chosen product', () => {
    const { result } = renderHook(() => useStartSavingsController());

    act(() => {
      result.current.selectProduct(product);
    });
    expect(result.current.selectedProduct?.id).toBe('product-1');
    expect(result.current.searchValue).toBe(product.name);

    act(() => {
      result.current.setSearchValue('iphone 11');
    });

    expect(result.current.selectedProduct).toBeNull();
    expect(result.current.variantOptionGroups).toEqual([]);
  });

  it('normalizes amount and date inputs while recalculating maturity', () => {
    const { result } = renderHook(() => useStartSavingsController());

    act(() => {
      result.current.setContributionAmount('₦50,000');
      result.current.setFrequency('weekly');
      result.current.setStartDate('2026-05-21T10:00:00.000Z');
      result.current.selectProduct(product);
    });

    expect(result.current.contributionAmount).toBe('50000');
    expect(result.current.frequency).toBe('weekly');
    expect(result.current.startDate).toBe('2026-05-21');
    expect(result.current.targetValue).toBe(800000);
    expect(result.current.maturityDate).toBe('2026-09-03');
  });

  it('derives explicit initial contribution and top-up amounts', () => {
    const { result } = renderHook(() => useStartSavingsController());

    act(() => {
      result.current.setContributionAmount('20000');
      result.current.setInitialContributionEnabled(true);
      result.current.setInitialContributionAmount('₦50,000');
    });

    expect(result.current.initialContributionAmount).toBe('50000');
    expect(result.current.effectiveInitialContribution).toBe(50000);
    expect(result.current.requiredTopUpAmount).toBe(0);
  });

  it('uses spendable wallet balance rather than earnings for required top-up', () => {
    mockUseWallet.mockReturnValue(walletData(6000, 50000));
    const { result } = renderHook(() => useStartSavingsController());

    act(() => {
      result.current.setContributionAmount('20000');
      result.current.setInitialContributionEnabled(true);
      result.current.setInitialContributionAmount('20000');
    });

    expect(result.current.requiredTopUpAmount).toBe(14000);
  });

  it('clears initial contribution state when switching to auto debit', () => {
    const { result } = renderHook(() => useStartSavingsController());

    act(() => {
      result.current.setInitialContributionEnabled(true);
      result.current.setInitialContributionAmount('₦50,000');
      result.current.handleContinue();
    });
    expect(result.current.initialContributionEnabled).toBe(true);
    expect(result.current.initialContributionAmount).toBe('50000');
    expect(result.current.formError).toBe(
      'Select the product you want to save for.'
    );

    act(() => {
      result.current.handleSourceModeChange('auto_debit');
    });

    expect(result.current.sourceMode).toBe('auto_debit');
    expect(result.current.initialContributionEnabled).toBe(false);
    expect(result.current.initialContributionAmount).toBe('');
    expect(result.current.formError).toBeNull();
    expect(mockSetPaymentMethodsError).toHaveBeenCalledWith(null);
  });

  it('requires a saved payment method for auto-debit funding continue', async () => {
    const { result } = renderHook(() => useStartSavingsController());

    act(() => {
      result.current.handleSourceModeChange('auto_debit');
    });
    await act(async () => {
      await result.current.handleFundingContinue();
    });

    expect(mockSetPaymentMethodsError).toHaveBeenCalledWith(
      'Select a saved card or authorize a new Paystack card.'
    );
    expect(mockSubmitSavingsGoal).not.toHaveBeenCalled();
  });

  it('creates the plan before opening plan funding for manual bank transfer', async () => {
    const { result } = renderHook(() => useStartSavingsController());

    act(() => {
      result.current.setSelectedFundingOption('bank_transfer');
      result.current.setShowFundingModal(true);
    });
    await act(async () => {
      await result.current.handleFundingContinue();
    });

    expect(result.current.showFundingModal).toBe(true);
    expect(mockSubmitSavingsGoal).toHaveBeenCalledWith({
      deferInitialContribution: true,
    });
    // The transfer modal opens only after the plan exists, so the plan's
    // dedicated funding account (not the wallet account) can be shown. That
    // handoff is covered in run-savings-goal-submission.test.ts.
    expect(result.current.showTransferModal).toBe(false);
  });
});
