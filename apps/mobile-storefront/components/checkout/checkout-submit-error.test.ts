import { router } from 'expo-router';
import { Alert } from 'react-native';
import { OrderError } from '@/services/orders.errors';
import type { CartItem } from '@/stores/cart-store.types';
import { handleCheckoutSubmitError } from './checkout-submit-error';

const mockRemoveItem = jest.fn();
let mockCartItems: CartItem[] = [];

// Re-export the REAL OrderError so `error instanceof OrderError` inside the
// handler matches the instances this test constructs, without pulling in the
// heavy `@/services/orders` module graph (supabase client, network stack).
jest.mock('@/services/orders', () => {
  const actual = jest.requireActual('@/services/orders.errors');
  return { OrderError: actual.OrderError };
});

jest.mock('@/services/analytics', () => ({
  trackError: jest.fn(),
}));

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
}));

jest.mock('@/stores/cart-store', () => ({
  useCartStore: {
    getState: () => ({ items: mockCartItems, removeItem: mockRemoveItem }),
  },
}));

function voucherLine(id: string): CartItem {
  return {
    id,
    product_id: `product-${id}`,
    slug: `slug-${id}`,
    name: `Prize ${id}`,
    price: 0,
    quantity: 1,
    voucher_token: `token-${id}`,
    voucher_award_id: `award-${id}`,
  };
}

function normalLine(id: string): CartItem {
  return {
    id,
    product_id: `product-${id}`,
    slug: `slug-${id}`,
    name: `Item ${id}`,
    price: 1000,
    quantity: 1,
  };
}

describe('handleCheckoutSubmitError', () => {
  beforeEach(() => {
    jest.mocked(router.push).mockClear();
    mockRemoveItem.mockClear();
    mockCartItems = [];
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    'CHECKOUT_ORDER_NOT_REUSABLE',
    'CHECKOUT_IDEMPOTENCY_CONFLICT',
  ])('directs the customer to the existing order instead of starting again for %s', (code) => {
    handleCheckoutSubmitError(
      new OrderError('Refresh checkout and start a new order', code),
      'paystack'
    );
    expect(Alert.alert).toHaveBeenCalledWith(
      'Check your existing order',
      expect.stringContaining(
        'Check your orders before starting another purchase'
      ),
      expect.any(Array)
    );
    const buttons = jest.mocked(Alert.alert).mock.calls.at(-1)?.[2];
    buttons?.find((button) => button.text === 'View orders')?.onPress?.();
    expect(router.push).toHaveBeenCalledWith('/orders');
    expect(mockRemoveItem).not.toHaveBeenCalled();
  });

  it('prunes voucher-backed lines when the order rejects an unredeemable voucher', () => {
    mockCartItems = [voucherLine('v1'), normalLine('n1')];

    handleCheckoutSubmitError(
      // The API surfaces the specific code in `details`; `code` is generic.
      new OrderError(
        'Your quiz prize voucher has expired.',
        'VALIDATION_ERROR',
        'QUIZ_VOUCHER_TOKEN_EXPIRED'
      ),
      'bank_transfer' as Parameters<typeof handleCheckoutSubmitError>[1]
    );

    // Only the voucher line is removed; the normal item is left untouched.
    expect(mockRemoveItem).toHaveBeenCalledTimes(1);
    expect(mockRemoveItem).toHaveBeenCalledWith('v1');
    expect(Alert.alert).toHaveBeenCalled();
  });

  it('prunes only the server-identified voucher line in a multi-voucher cart', () => {
    mockCartItems = [voucherLine('v1'), voucherLine('v2')];

    const error = new OrderError(
      'Quiz voucher token has expired',
      'VALIDATION_ERROR',
      'QUIZ_VOUCHER_TOKEN_EXPIRED'
    );
    // The orders API identified the exact failed token (v2's).
    error.rejectedVoucherToken = 'token-v2';

    handleCheckoutSubmitError(
      error,
      'bank_transfer' as Parameters<typeof handleCheckoutSubmitError>[1]
    );

    // Only the rejected voucher is removed; v1 survives to be redeemed.
    expect(mockRemoveItem).toHaveBeenCalledTimes(1);
    expect(mockRemoveItem).toHaveBeenCalledWith('v2');
  });

  it('does NOT prune a multi-voucher cart when the server did not identify one', () => {
    mockCartItems = [voucherLine('v1'), voucherLine('v2')];

    handleCheckoutSubmitError(
      new OrderError(
        'Invalid quiz voucher token',
        'VALIDATION_ERROR',
        'QUIZ_VOUCHER_TOKEN_INVALID'
      ),
      'bank_transfer' as Parameters<typeof handleCheckoutSubmitError>[1]
    );

    // No specific line identified → keep both rather than discard a valid prize.
    expect(mockRemoveItem).not.toHaveBeenCalled();
  });

  it('does NOT prune when two valid vouchers conflict (redeem one at a time)', () => {
    mockCartItems = [voucherLine('v1'), voucherLine('v2')];

    handleCheckoutSubmitError(
      new OrderError(
        'Only one quiz voucher can be redeemed per order',
        'VALIDATION_ERROR',
        'QUIZ_VOUCHER_MULTIPLE'
      ),
      'bank_transfer' as Parameters<typeof handleCheckoutSubmitError>[1]
    );

    // Both vouchers stay valid — none should be discarded.
    expect(mockRemoveItem).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalled();
  });

  it('does NOT prune voucher lines for an unrelated validation error', () => {
    mockCartItems = [voucherLine('v1'), normalLine('n1')];

    handleCheckoutSubmitError(
      new OrderError(
        'Your cart total changed.',
        'VALIDATION_ERROR',
        'order_total_mismatch'
      ),
      'bank_transfer' as Parameters<typeof handleCheckoutSubmitError>[1]
    );

    expect(mockRemoveItem).not.toHaveBeenCalled();
  });
});
