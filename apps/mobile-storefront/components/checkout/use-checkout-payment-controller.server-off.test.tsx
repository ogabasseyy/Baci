import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { renderHook } from '@testing-library/react-native';
import {
  clearObservedPiggyvestPrimaryCapability,
  observePiggyvestPrimaryCapability,
} from '@/lib/piggyvest-primary-capability-cache';
import type { CartItem } from '@/stores/cart-store';
import { useCheckoutPaymentController } from './use-checkout-payment-controller';

let mockWallet: Record<string, unknown> | undefined;
let mockIsRefetching = false;
let mockIsError = false;
let mockCapability: boolean | null = null;
let mockFetchingNow = false;
let mockLiveVerdict = {
  walletIsStoreCredit: false,
  walletPrimaryUnknown: false,
};

jest.mock('@/lib/piggyvest-primary-capability', () => ({
  usePiggyvestPrimaryCapability: () => mockCapability,
}));

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
    getWalletError: () => null,
    getWalletVerdict: () => mockLiveVerdict,
    isError: mockIsError,
    isFetchingNow: () => mockFetchingNow,
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
    mockCapability = false;
    observePiggyvestPrimaryCapability('merchant-1', false);
  });
  afterEach(() => {
    clearObservedPiggyvestPrimaryCapability();
    mockCapability = null;
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
    // PiggyVest confirmed for the merchant: the wallet decides the rest.
    observePiggyvestPrimaryCapability('merchant-1', true);
  });
  afterEach(() => {
    clearObservedPiggyvestPrimaryCapability();
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

  it('keeps bank transfer to wallet through a refresh where the server rules PiggyVest out', () => {
    // Arrange: non-PiggyVest merchant, cached legacy wallet, failing refresh.
    mockCapability = false;
    observePiggyvestPrimaryCapability('merchant-1', false);
    mockWallet = { balance: 0 };
    mockIsRefetching = true;
    mockIsError = true;

    // Act
    const { result } = renderController();
    mockCapability = null;
    mockIsRefetching = false;
    mockIsError = false;

    // Assert: exactly as before this change.
    expect(result.current.walletFundedBankTransferOptionEnabled).toBe(true);
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

  it('holds bank transfer to wallet for a user with no customer row yet', () => {
    mockWallet = { balance: 0, owner_unresolved: true };

    const { result } = renderController();

    expect(result.current.walletFundedBankTransferOptionEnabled).toBe(false);
  });

  it('exposes a live re-check that holds once the wallet turns PiggyVest', () => {
    // Arrange: legacy at render; the cache now reads PiggyVest store credit.
    mockWallet = { balance: 0 };
    mockLiveVerdict = {
      walletIsStoreCredit: true,
      walletPrimaryUnknown: false,
    };

    // Act
    const { result } = renderController();
    const held = result.current.isWalletFundedBankTransferHeld();
    mockLiveVerdict = {
      walletIsStoreCredit: false,
      walletPrimaryUnknown: false,
    };

    // Assert
    expect(result.current.walletFundedBankTransferOptionEnabled).toBe(true);
    expect(held).toBe(true);
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

describe('bugfix: stale render-time capability at checkout submit', () => {
  beforeEach(() => {
    mockWallet = { balance: 0 };
    mockCapability = false;
    mockLiveVerdict = {
      walletIsStoreCredit: false,
      walletPrimaryUnknown: false,
    };
  });
  afterEach(() => {
    clearObservedPiggyvestPrimaryCapability();
    mockCapability = null;
    mockFetchingNow = false;
  });

  it('holds the transfer when the ruling-out expired and the wallet is refetching', () => {
    // Arrange: rendered as ruled out; by submit the cached negative has
    // expired (no current verdict) and the wallet recheck is in flight.
    const { result } = renderController();
    mockFetchingNow = true;

    // Act
    const held = result.current.isWalletFundedBankTransferHeld();

    // Assert
    expect(held).toBe(true);
  });

  it('keeps the transfer while the server ruling-out is still current', () => {
    observePiggyvestPrimaryCapability('merchant-1', false);
    const { result } = renderController();
    mockFetchingNow = true;

    expect(result.current.isWalletFundedBankTransferHeld()).toBe(false);
  });

  it('bugfix: holds when the ruling-out expired before the wallet refetch starts', () => {
    // Arrange: rendered as ruled out; the cached negative has expired, but
    // nothing has refetched yet and the cached wallet is still legacy.
    const { result } = renderController();
    mockFetchingNow = false;

    // Act + Assert
    expect(result.current.isWalletFundedBankTransferHeld()).toBe(true);
  });
});

describe('bugfix: restored legacy wallet trusted before the PiggyVest verdict', () => {
  beforeEach(() => {
    clearObservedPiggyvestPrimaryCapability();
  });
  afterEach(() => {
    clearObservedPiggyvestPrimaryCapability();
    mockCapability = null;
  });

  it('holds bank transfer to wallet until the merchant verdict is known', () => {
    // Arrange: cold start; a fresh legacy wallet is restored from the
    // persisted cache and the capability probe has not answered yet.
    mockCapability = null;
    mockWallet = { balance: 0 };

    // Act
    const { result } = renderController();

    // Assert
    expect(result.current.walletFundedBankTransferOptionEnabled).toBe(false);
    expect(result.current.isWalletFundedBankTransferHeld()).toBe(true);
  });
});
