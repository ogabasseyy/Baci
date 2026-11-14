import { jest } from '@jest/globals';
import type { StartSavingsController } from './start-savings-controller.types';

/**
 * A start-savings controller for rendering tests. Defaults to production with
 * PiggyVest off: the legacy wallet, auto debit offered, no interest question.
 */
export function createStartSavingsController(
  overrides: Partial<StartSavingsController> = {}
): StartSavingsController {
  return {
    acceptsNonWithdrawableTerms: false,
    allowAutoDebit: true,
    askInterest: false,
    contributionAmount: '2000',
    contributionValue: 2000,
    effectiveInitialContribution: 0,
    variantOptionGroups: [],
    debouncedSearch: '',
    formError: null,
    frequency: 'daily',
    goToWallet: jest.fn(),
    handleContinue: jest.fn(),
    handleFundingContinue: jest.fn(() => Promise.resolve()),
    handleSourceModeChange: jest.fn(),
    initialContributionAmount: '',
    initialContributionEnabled: false,
    interestChoice: null,
    isAuthorizingCard: false,
    isLoadingPaymentMethods: false,
    isProductsLoading: false,
    isSubmitting: false,
    maturityDate: '2027-03-17',
    paymentMethodsError: null,
    preferredDebitTime: '08:00',
    primaryWallet: false,
    products: [],
    safeWalletBalance: 0,
    savedPaymentMethods: [],
    searchValue: '',
    selectProduct: jest.fn(),
    selectedFundingOption: 'wallet',
    selectedPaymentMethodId: null,
    selectedProduct: {
      id: 'phone',
      name: 'Sandbox Test Phone',
      image: '',
      slug: 'phone',
      price: 250000,
      variantId: null,
      requiresVariantSelection: false,
      conditionLabel: 'New',
    },
    setAcceptsNonWithdrawableTerms: jest.fn(),
    setContributionAmount: jest.fn(),
    setFrequency: jest.fn(),
    setInitialContributionAmount: jest.fn(),
    setInitialContributionEnabled: jest.fn(),
    setInterestChoice: jest.fn(),
    setPaymentMethodsError: jest.fn(),
    setPreferredDebitTime: jest.fn(),
    setSearchValue: jest.fn(),
    setSelectedFundingOption: jest.fn(),
    setSelectedPaymentMethodId: jest.fn(),
    setShowFundingModal: jest.fn(),
    setShowPreviewModal: jest.fn(),
    setStartDate: jest.fn(),
    showFundingModal: false,
    showPreviewModal: false,
    showSuccessModal: false,
    showTransferModal: false,
    sourceMode: 'manual',
    startDate: '2026-11-12',
    targetAmount: '250000',
    targetValue: 250000,
    ...overrides,
  } as unknown as StartSavingsController;
}

/** The same controller for a customer whose wallet is their PiggyVest wallet. */
export function createPrimaryStartSavingsController(
  overrides: Partial<StartSavingsController> = {}
): StartSavingsController {
  return createStartSavingsController({
    allowAutoDebit: false,
    askInterest: true,
    primaryWallet: true,
    ...overrides,
  });
}
