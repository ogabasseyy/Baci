import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';
import type { CartItem } from '@/stores/cart-store';
import { useCheckoutPaymentController } from './use-checkout-payment-controller';

let mockWallet: Record<string, unknown> | undefined;
let mockIsRefetching = false;
let mockIsError = false;

jest.mock('@/hooks/use-checkout-savings', () => ({
  useCheckoutSavings: () => ({
    checkoutSavingsBalance: 0,
    getLiveSavingsSelection: () => undefined,
    savingsSelection: undefined,
  }),
}));

jest.mock('@/hooks/use-wallet', () => ({
  useWallet: () => ({
    data: mockWallet ? { wallet: mockWallet } : undefined,
    isError: mockIsError,
    isRefetching: mockIsRefetching,
  }),
}));

// The merchant runs "Bank transfer to wallet" (wallet auto-debit) today.
jest.mock('@/hooks/useMerchantPaymentSettings', () => ({
  getEnabledPaymentMethods: () => ['paystack', 'bank_transfer'],
  getMerchantTaxRate: () => 0,
  useMerchantPaymentSettings: () => ({
    data: {
      paystack_enabled: true,
      wallet_order_auto_debit_enabled: true,
      wallet_paystack_dva_enabled: true,
    },
  }),
}));

jest.mock('@/lib/commerce-brain', () => ({
  calculateCommerce: () => Promise.reject(new Error('offline')),
}));

jest.mock('@/services/redvault', () => ({
  getRedvaultPaymentAvailability: () => new Promise(() => undefined),
}));

const items: CartItem[] = [
  {
    id: 'line-1',
    name: 'iPhone 13',
    price: 500_000,
    product_id: 'product-1',
    quantity: 1,
    slug: 'iphone-13',
  },
];

function renderController() {
  return renderHook(() =>
    useCheckoutPaymentController({
      assuranceFee: 0,
      customerId: 'customer-1',
      customerPhone: '08012345678',
      deliveryFee: 0,
      isAuthenticated: true,
      items,
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      step: 'payment',
      subtotal: 500_000,
    })
  );
}

describe('checkout wallet with the server keeping PiggyVest off', () => {
  beforeEach(() => {
    mockWallet = undefined;
  });

  it('keeps the wallet wording and bank transfer to wallet as today', () => {
    // Arrange: no primary_balance_kobo, so no PiggyVest wallet.
    mockWallet = { balance: 0 };

    // Act
    const { result } = renderController();

    // Assert
    expect(result.current.walletIsStoreCredit).toBe(false);
    expect(result.current.walletBalance).toBe(0);
    expect(result.current.walletFundedBankTransferOptionEnabled).toBe(true);
  });
});

describe('bugfix: PiggyVest balance offered as spendable at checkout', () => {
  beforeEach(() => {
    mockWallet = undefined;
  });

  it('shows ₦0 store credit and the direct bank transfer for ₦5,000 PiggyVest, ₦0 legacy', () => {
    // Arrange: ₦5,000 at PiggyVest, nothing in the older wallet.
    mockWallet = { balance: 0, primary_balance_kobo: 500_000 };

    // Act
    const { result } = renderController();

    // Assert: checkout spends only store credit, and never offers to top up
    // the older wallet ("Bank transfer to wallet"): the standard per-order
    // transfer pays the order directly.
    expect(result.current.walletIsStoreCredit).toBe(true);
    expect(result.current.walletBalance).toBe(0);
    expect(result.current.walletFundedBankTransferOptionEnabled).toBe(false);
  });

  it('holds bank transfer to wallet while the PiggyVest check is unknown', () => {
    // Arrange: the PiggyVest check timed out, so the wallet may be PiggyVest.
    mockWallet = { balance: 0, primary_unavailable: true };

    // Act
    const { result } = renderController();

    // Assert: wording stays as today, but no transfer into a wallet that may
    // route to PiggyVest savings.
    expect(result.current.walletIsStoreCredit).toBe(false);
    expect(result.current.walletFundedBankTransferOptionEnabled).toBe(false);
  });

  it('holds bank transfer to wallet while a cached legacy wallet refreshes', () => {
    // Arrange: a cached legacy answer is being refetched and may come back
    // PiggyVest-ready.
    mockWallet = { balance: 0 };
    mockIsRefetching = true;

    // Act
    const { result } = renderController();
    mockIsRefetching = false;

    // Assert
    expect(result.current.walletFundedBankTransferOptionEnabled).toBe(false);
  });

  it('holds bank transfer to wallet after a failed wallet refresh', () => {
    // Arrange: a refresh failed, leaving the cached legacy answer behind.
    mockWallet = { balance: 0 };
    mockIsError = true;

    // Act
    const { result } = renderController();
    mockIsError = false;

    // Assert
    expect(result.current.walletFundedBankTransferOptionEnabled).toBe(false);
  });

  it('holds bank transfer to wallet while the PiggyVest account is pending', () => {
    mockWallet = { balance: 0, primary_pending: true };

    const { result } = renderController();

    expect(result.current.walletIsStoreCredit).toBe(false);
    expect(result.current.walletFundedBankTransferOptionEnabled).toBe(false);
  });

  it('holds bank transfer to wallet until the wallet has loaded', () => {
    // Arrange: the wallet query has not answered yet.
    mockWallet = undefined;

    // Act
    const { result } = renderController();

    // Assert
    expect(result.current.walletFundedBankTransferOptionEnabled).toBe(false);
  });

  it('keeps existing store credit spendable for a PiggyVest customer', () => {
    mockWallet = { balance: 2_000, primary_balance_kobo: 500_000 };

    const { result } = renderController();

    expect(result.current.walletBalance).toBe(2_000);
  });
});
