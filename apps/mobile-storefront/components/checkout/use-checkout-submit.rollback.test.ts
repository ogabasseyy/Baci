import { jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { applyCheckoutCreditSnapshot } from '@/lib/checkout-attempt-credit-snapshot';
import type { RepriceResult } from '@/services/cart-reprice';
import type { CartItem } from '@/stores/cart-store.types';
import { createOrderResponseFixture } from './checkout-order-response-fixture';
import { useCheckoutSubmit } from './use-checkout-submit';
import {
  address,
  cartItem,
  createParams,
  generation,
} from './use-checkout-submit.setup';

const mockRepriceCartItems = jest.fn() as jest.MockedFunction<
  (items: CartItem[], merchantId: string) => Promise<RepriceResult>
>;
const mockCreateOrder =
  jest.fn<typeof import('@/services/orders').createOrder>();
const mockSubmitBnplCheckout = jest.fn();
const mockBuildCheckoutOrderRequest = jest.fn();
const mockValidateCheckoutSubmission =
  jest.fn<
    typeof import('./checkout-submit-validation').validateCheckoutSubmission
  >();
const mockRepriceItems = jest.fn();
const mockRestoreItems = jest.fn<
  (
    items: CartItem[],
    cartWideNegotiationActive?: boolean,
    checkoutGeneration?: string
  ) => Promise<void>
>(async () => undefined);
const mockRestore = jest.fn<(input: unknown) => Promise<void>>(
  async () => undefined
);
const mockRunFinalizeCheckoutPayment =
  jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockUseMerchant = jest.fn() as jest.MockedFunction<
  () => { data: { id: string } | null }
>;
let cartItems: CartItem[] = [];

const mockStorage = new Map<string, string>();
let mockGetItemFailure: { error: Error; keySubstring: string } | null = null;
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: (key: string) =>
    mockGetItemFailure && key.includes(mockGetItemFailure.keySubstring)
      ? Promise.reject(mockGetItemFailure.error)
      : Promise.resolve(mockStorage.get(key) ?? null),
  setItem: (key: string, value: string) => {
    mockStorage.set(key, value);
    return Promise.resolve();
  },
  removeItem: (key: string) => {
    mockStorage.delete(key);
    return Promise.resolve();
  },
}));

jest.mock('@/services/cart-reprice', () => ({
  repriceCartItems: (items: CartItem[], merchantId: string) =>
    mockRepriceCartItems(items, merchantId),
  pickChangedPriceById: () => ({}),
}));

jest.mock('@/services/orders', () => ({
  createOrder: (
    ...args: Parameters<typeof import('@/services/orders').createOrder>
  ) => mockCreateOrder(...args),
}));

jest.mock('@/lib/wallet-payment-helpers', () => ({
  buildSavingsOrderFields: jest.fn(() => ({})),
  buildWalletOrderFields: jest.fn(() => ({
    use_wallet_credit: true,
    wallet_amount: 1000,
  })),
  getFullyPaidStoreCreditPaymentMethod: jest.fn(() => undefined),
}));

jest.mock('@/services/analytics', () => ({
  trackCheckoutStep: jest.fn(),
}));

jest.mock('@/services/tiktok-checkout-route-tracking', () => ({
  trackCheckoutRoutePurchaseCompleted: jest.fn(),
}));

jest.mock('@/stores/cart-store', () => ({
  useCartStore: jest.fn(),
}));

jest.mock('@/hooks/use-merchant', () => ({
  useMerchant: () => mockUseMerchant(),
}));

jest.mock('./checkout-bnpl-submit', () => ({
  submitBnplCheckout: (...args: unknown[]) => mockSubmitBnplCheckout(...args),
}));

jest.mock('./checkout-order-builders', () => ({
  buildCheckoutOrderRequest: (...args: unknown[]) =>
    mockBuildCheckoutOrderRequest(...args),
  createCheckoutSnapshot: jest.fn(() => ({
    deliveryFee: 1500,
    subtotal: 1200000,
    taxAmount: 0,
    total: 1201500,
  })),
}));

jest.mock('./run-finalize-checkout-payment', () => ({
  runFinalizeCheckoutPayment: (...args: unknown[]) =>
    mockRunFinalizeCheckoutPayment(...args),
}));

jest.mock('./checkout-post-order-side-effects', () => ({
  runCheckoutPostOrderSideEffects: jest.fn(),
}));

jest.mock('./checkout-store-credit', () => ({
  resolveCheckoutStoreCreditSelections: jest.fn(() => ({
    liveSavingsSelection: undefined,
    liveWalletSelection: undefined,
  })),
}));

jest.mock('./restore-emptied-checkout-cart', () => ({
  restoreEmptiedCheckoutCart: (input: unknown) => mockRestore(input),
}));

const mockHandleSubmitError = jest.fn();
jest.mock('./checkout-submit-error', () => ({
  handleCheckoutSubmitError: (...args: unknown[]) =>
    mockHandleSubmitError(...args),
}));

jest.mock('./checkout-submit-validation', () => ({
  validateCheckoutSubmission: (
    input: Parameters<
      typeof import('./checkout-submit-validation').validateCheckoutSubmission
    >[0]
  ) => mockValidateCheckoutSubmission(input),
}));

const mockedUseCartStore = (
  jest.requireMock('@/stores/cart-store') as {
    useCartStore: jest.Mock & {
      getState?: () => {
        items: CartItem[];
        checkoutGeneration: string;
        cartWideNegotiationActive: boolean;
        repriceItems: typeof mockRepriceItems;
        restoreItems: typeof mockRestoreItems;
      };
    };
  }
).useCartStore;

describe('useCheckoutSubmit rollback credit', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStorage.clear();
    mockGetItemFailure = null;
    cartItems = [cartItem];
    mockUseMerchant.mockReturnValue({ data: { id: 'merchant-1' } });
    mockedUseCartStore.getState = () => ({
      items: cartItems,
      checkoutGeneration: generation,
      cartWideNegotiationActive: false,
      repriceItems: mockRepriceItems,
      restoreItems: mockRestoreItems,
    });
    mockValidateCheckoutSubmission.mockReturnValue(true);
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('rolls back with the submitted frozen credit, not live UI selections', async () => {
    // A previous attempt froze wallet 5000; the shopper then edited the
    // UI down to 1000 before resubmitting.
    await applyCheckoutCreditSnapshot(
      { use_wallet_credit: true, wallet_amount: 5000 },
      generation
    );
    mockRepriceCartItems.mockResolvedValue({
      changes: [],
      priceById: { 'line-1': 1200000 },
    });
    mockCreateOrder.mockImplementation(async (request) => {
      // Mirror production: freeze the request, substituting the stored
      // choice for the edited live fields.
      await applyCheckoutCreditSnapshot(request, generation);
      return {
        amountDueToGateway: 1201500,
        idempotency: { replayed: false },
        order: {
          created_at: '2026-07-09T12:00:00.000Z',
          id: 'order-1',
          order_number: 'ORD-1',
          payment_status: 'pending',
          shipping_status: 'pending',
          total: 1201500,
        },
        wallet: null,
      } as never;
    });
    mockRunFinalizeCheckoutPayment.mockRejectedValueOnce(
      new Error('routing failed')
    );
    const params = createParams();
    const { result } = renderHook(() => useCheckoutSubmit(params));

    await act(async () => {
      await result.current(address);
    });

    expect(mockRestore).toHaveBeenCalledWith(
      expect.objectContaining({
        checkoutGeneration: generation,
        creditFields: { use_wallet_credit: true, wallet_amount: 5000 },
        hadSortMarker: false,
      })
    );
  });

  it('restores the submitted generation when it differs from the snapshot', async () => {
    // Checkout began before generation restoration completed: the cart
    // snapshot is stale, but createOrder submitted under the restored
    // identity. Rollback must follow the submitted generation so a retry
    // replays the created order instead of forking the idempotency key.
    const submitted = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    mockRepriceCartItems.mockResolvedValue({
      changes: [],
      priceById: { 'line-1': 1200000 },
    });
    mockCreateOrder.mockResolvedValue(
      createOrderResponseFixture({
        effectiveCheckoutGeneration: submitted,
      })
    );
    mockRunFinalizeCheckoutPayment.mockRejectedValueOnce(
      new Error('routing failed')
    );
    const params = createParams();
    const { result } = renderHook(() => useCheckoutSubmit(params));

    await act(async () => {
      await result.current(address);
    });

    expect(mockRestore).toHaveBeenCalledWith(
      expect.objectContaining({ checkoutGeneration: submitted })
    );
  });

  it('skips cart restore when the marker read is inconclusive', async () => {
    // Post-restart shape: the minted registry is empty and the marker
    // read fails, so the sort mode is unknown. Restoring the cart would
    // risk a locale-ordered retry under a forked idempotency key.
    mockRepriceCartItems.mockResolvedValue({
      changes: [],
      priceById: { 'line-1': 1200000 },
    });
    mockCreateOrder.mockResolvedValue(
      createOrderResponseFixture({
        effectiveCheckoutGeneration: generation,
      })
    );
    mockGetItemFailure = {
      error: new Error('store hung'),
      keySubstring: 'checkout-idempotency-item-sort-v2',
    };
    mockRunFinalizeCheckoutPayment.mockRejectedValueOnce(
      new Error('routing failed')
    );
    const params = createParams();
    const { result } = renderHook(() => useCheckoutSubmit(params));

    await act(async () => {
      await result.current(address);
    });

    expect(mockRestore).not.toHaveBeenCalled();
    expect(mockHandleSubmitError).toHaveBeenCalledWith(
      expect.any(Error),
      'paystack'
    );
  });
});
