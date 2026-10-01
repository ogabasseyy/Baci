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
  trackCheckoutPaymentFailed: jest.fn(),
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
    const { useCartStore } = jest.requireMock('@/stores/cart-store') as {
      useCartStore: { getState: () => unknown };
    };
    useCartStore.getState = () => ({
      items: mockCartItems,
      removeItem: mockRemoveItem,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('directs the customer to the existing order for an idempotency conflict', () => {
    handleCheckoutSubmitError(
      new OrderError(
        'Refresh checkout and start a new order',
        'CHECKOUT_IDEMPOTENCY_CONFLICT'
      ),
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
  });

  it('does not record order-creation conflicts as payment failures', () => {
    const { trackCheckoutPaymentFailed } = jest.requireMock(
      '@/services/analytics'
    ) as { trackCheckoutPaymentFailed: jest.Mock };
    trackCheckoutPaymentFailed.mockClear();

    handleCheckoutSubmitError(
      new OrderError(
        'Refresh checkout and start a new order',
        'CHECKOUT_IDEMPOTENCY_CONFLICT'
      ),
      'paystack'
    );
    handleCheckoutSubmitError(
      new OrderError(
        'This checkout order can no longer be reused.',
        'CHECKOUT_ORDER_NOT_REUSABLE'
      ),
      'paystack'
    );

    // Neither duplicate-submission nor stale-reusable-order conflicts
    // declined a payment: the funnel must not see payment_failed.
    expect(trackCheckoutPaymentFailed).not.toHaveBeenCalled();
  });

  it('lets the shopper start a replacement checkout after a cancelled non-reusable order', () => {
    const advanceCheckoutGeneration = jest.fn();
    const { useCartStore } = jest.requireMock('@/stores/cart-store') as {
      useCartStore: { getState: () => unknown };
    };
    useCartStore.getState = () => ({
      items: mockCartItems,
      removeItem: mockRemoveItem,
      advanceCheckoutGeneration,
    });
    handleCheckoutSubmitError(
      new OrderError(
        'This checkout order can no longer be reused.',
        'CHECKOUT_ORDER_NOT_REUSABLE'
      ),
      'paystack'
    );
    const buttons = jest.mocked(Alert.alert).mock.calls.at(-1)?.[2];
    buttons
      ?.find((button) => button.text === 'Start a new checkout')
      ?.onPress?.();
    expect(advanceCheckoutGeneration).toHaveBeenCalledTimes(1);
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

  it.each([
    ['NETWORK_ERROR'],
    ['VALIDATION_ERROR'],
    ['AUTH_ERROR'],
  ])('does not record pre-order %s failures as payment failures', (code) => {
    const { trackCheckoutPaymentFailed, trackError } = jest.requireMock(
      '@/services/analytics'
    ) as {
      trackCheckoutPaymentFailed: jest.Mock;
      trackError: jest.Mock;
    };
    trackCheckoutPaymentFailed.mockClear();
    trackError.mockClear();

    handleCheckoutSubmitError(
      new OrderError('pre-order failure', code),
      'paystack' as Parameters<typeof handleCheckoutSubmitError>[1]
    );

    expect(trackCheckoutPaymentFailed).not.toHaveBeenCalled();
    // Diagnostics still fire; only the funnel event is suppressed.
    expect(trackError).toHaveBeenCalledWith(
      'checkout_failed',
      'pre-order failure',
      expect.objectContaining({ errorCode: code })
    );
  });

  it.each([
    ['TIMEOUT_ERROR'],
    ['RETRY_EXHAUSTED'],
    ['SERVER_ERROR'],
    ['UNKNOWN_ERROR'],
    ['NOT_FOUND'],
    ['RESPONSE_PARSE_ERROR'],
    ['RESPONSE_VALIDATION_ERROR'],
  ])('does not record order-API %s failures as payment failures', (code) => {
    const { trackCheckoutPaymentFailed, trackError } = jest.requireMock(
      '@/services/analytics'
    ) as {
      trackCheckoutPaymentFailed: jest.Mock;
      trackError: jest.Mock;
    };
    trackCheckoutPaymentFailed.mockClear();
    trackError.mockClear();

    handleCheckoutSubmitError(
      new OrderError('order API failure', code),
      'paystack' as Parameters<typeof handleCheckoutSubmitError>[1]
    );

    // The order API failed before an order or payment attempt existed.
    expect(trackCheckoutPaymentFailed).not.toHaveBeenCalled();
    expect(trackError).toHaveBeenCalledWith(
      'checkout_failed',
      'order API failure',
      expect.objectContaining({ errorCode: code })
    );
  });

  it('does not record a repricing failure as a payment failure', () => {
    const { trackCheckoutPaymentFailed, trackError } = jest.requireMock(
      '@/services/analytics'
    ) as {
      trackCheckoutPaymentFailed: jest.Mock;
      trackError: jest.Mock;
    };
    trackCheckoutPaymentFailed.mockClear();
    trackError.mockClear();

    // repriceCartItems throws ordinary errors before any order or payment
    // attempt starts; the fallback branch must not invent a payment decline.
    handleCheckoutSubmitError(
      new Error('reprice lookup failed'),
      'paystack' as Parameters<typeof handleCheckoutSubmitError>[1]
    );

    expect(trackCheckoutPaymentFailed).not.toHaveBeenCalled();
    expect(trackError).toHaveBeenCalledWith(
      'checkout_failed',
      'reprice lookup failed',
      expect.objectContaining({ step: 'place_order' })
    );
    expect(Alert.alert).toHaveBeenCalledWith(
      'Error',
      'Failed to place order. Please try again.',
      expect.any(Array)
    );
  });

  it('records post-start payment failures', () => {
    const { trackCheckoutPaymentFailed } = jest.requireMock(
      '@/services/analytics'
    ) as { trackCheckoutPaymentFailed: jest.Mock };
    trackCheckoutPaymentFailed.mockClear();

    // No current submit path raises a post-start code (verify/decline
    // failures surface in later screens, not in the submit catch), so this
    // locks the safety-net branch with a representative provider decline.
    handleCheckoutSubmitError(
      new OrderError('card declined', 'PAYMENT_DECLINED'),
      'paystack' as Parameters<typeof handleCheckoutSubmitError>[1],
      'order-9'
    );

    expect(trackCheckoutPaymentFailed).toHaveBeenCalledWith(
      'PAYMENT_DECLINED',
      'order-9',
      'paystack'
    );
  });

  it('suppresses funnel failures for rejected provider initialization', () => {
    const { trackCheckoutPaymentFailed, trackError } = jest.requireMock(
      '@/services/analytics'
    ) as { trackCheckoutPaymentFailed: jest.Mock; trackError: jest.Mock };
    trackCheckoutPaymentFailed.mockClear();
    trackError.mockClear();

    // createOrder committed order-9 before Paystack init rejected, but the
    // initializer emits payment_started only on success: no flow opened, so
    // the funnel failure would be unmatched. The diagnostic still fires.
    handleCheckoutSubmitError(
      new OrderError('Failed to initialize payment', 'PAYMENT_INIT_ERROR'),
      'paystack' as Parameters<typeof handleCheckoutSubmitError>[1],
      'order-9'
    );

    expect(trackCheckoutPaymentFailed).not.toHaveBeenCalled();
    expect(trackError).toHaveBeenCalledWith(
      'checkout_failed',
      'Failed to initialize payment',
      expect.objectContaining({ errorCode: 'PAYMENT_INIT_ERROR' })
    );
  });

  it('suppresses funnel failures for timed-out provider initialization', () => {
    const { trackCheckoutPaymentFailed, trackError } = jest.requireMock(
      '@/services/analytics'
    ) as { trackCheckoutPaymentFailed: jest.Mock; trackError: jest.Mock };
    trackCheckoutPaymentFailed.mockClear();
    trackError.mockClear();

    handleCheckoutSubmitError(
      new OrderError(
        'Payment initialization timed out',
        'PAYMENT_INIT_TIMEOUT'
      ),
      'klump' as Parameters<typeof handleCheckoutSubmitError>[1],
      'order-9'
    );

    expect(trackCheckoutPaymentFailed).not.toHaveBeenCalled();
    expect(trackError).toHaveBeenCalledWith(
      'checkout_failed',
      'Payment initialization timed out',
      expect.objectContaining({ errorCode: 'PAYMENT_INIT_TIMEOUT' })
    );
  });
});
