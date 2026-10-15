import { act, renderHook, waitFor } from '@testing-library/react-native';
import { NativeCartError } from '@/lib/cart/native-cart-error';
import type { NativeCheckoutSnapshot } from '@/schemas/cart-checkout-snapshot';
import { useNativeSharedCartStore } from '@/stores/native-shared-cart-store';
import { useCartCheckoutSnapshot } from './use-cart-checkout-snapshot';

jest.mock('expo-crypto', () => ({ randomUUID: () => 'op-1' }));
const merchantId = '11111111-1111-4111-8111-111111111111';
const cartId = '22222222-2222-4222-8222-222222222222';
const cartSnapshot = {
  cartId,
  merchantId,
  state: 'active' as const,
  version: 3,
  lines: [],
  currency: 'NGN',
  subtotalMinor: 100,
  totalMinor: 100,
  estimatedTotals: false,
  expiresAt: '2099-01-01T00:00:00Z',
};
const review: NativeCheckoutSnapshot = {
  checkoutSessionId: '66666666-6666-4666-8666-666666666666',
  generation: 1,
  cartVersion: 3,
  cartId,
  merchantId,
  lines: [
    {
      id: '77777777-7777-4777-8777-777777777777',
      productId: '33333333-3333-4333-8333-333333333333',
      variantId: null,
      condition: 'new',
      options: {},
      quantity: 1,
      negotiatedUnitPriceMinor: null,
      negotiationStatus: null,
      negotiationInvalidated: false,
      voucherToken: null,
      voucherAwardId: null,
      hasAssurance: false,
      assuranceRate: null,
      lastUnitPriceMinor: 100,
      validatedUnitPriceMinor: 100,
      effectiveUnitPriceMinor: 100,
      priceChanged: false,
      available: true,
      unavailableReason: null,
      stockQty: 5,
      manageStock: true,
    },
  ],
  estimates: {
    subtotalMinor: 100,
    currency: 'NGN',
    lineCount: 1,
    unavailableCount: 0,
  },
};
beforeEach(() => {
  useNativeSharedCartStore.setState({
    enabled: true,
    snapshot: cartSnapshot,
    checkoutReview: null,
    prepareCheckoutReview: jest.fn().mockResolvedValue({
      snapshot: review,
      replayed: false,
      sessionReused: true,
    }),
    refresh: jest.fn().mockResolvedValue(undefined),
  });
});
it('prepares a review and exposes the order binding for the current version', async () => {
  const { result } = renderHook(() => useCartCheckoutSnapshot());
  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(result.current.binding).toEqual({
    cart_id: cartId,
    checkout_session_id: review.checkoutSessionId,
    checkout_generation: 1,
    cart_version: 3,
  });
  expect(result.current.availableLines).toHaveLength(1);
  expect(useNativeSharedCartStore.getState().checkoutReview).toEqual(review);
});
it('marks the review stale when the cart version moves and re-reviews', async () => {
  const { result } = renderHook(() => useCartCheckoutSnapshot());
  await waitFor(() => expect(result.current.status).toBe('ready'));
  act(() => {
    useNativeSharedCartStore.setState({
      snapshot: { ...cartSnapshot, version: 4 },
    });
  });
  expect(result.current.stale).toBe(true);
  expect(result.current.binding).toBeNull();
});
it('refreshes instead of submitting when preparation reports version drift', async () => {
  const refresh = jest.fn().mockResolvedValue(undefined);
  useNativeSharedCartStore.setState({
    refresh,
    prepareCheckoutReview: jest
      .fn()
      .mockRejectedValue(new NativeCartError('refresh_required')),
  });
  const { result } = renderHook(() => useCartCheckoutSnapshot());
  await waitFor(() => expect(result.current.status).toBe('stale'));
  expect(refresh).toHaveBeenCalled();
  expect(result.current.binding).toBeNull();
});
it('does not prepare again for a polling snapshot with the same merchant/cart/version', async () => {
  const prepare = jest.fn().mockResolvedValue({ snapshot: review });
  useNativeSharedCartStore.setState({ prepareCheckoutReview: prepare });
  const { result } = renderHook(() => useCartCheckoutSnapshot());
  await waitFor(() => expect(result.current.status).toBe('ready'));
  act(() =>
    useNativeSharedCartStore.setState({ snapshot: { ...cartSnapshot } })
  );
  await act(async () => {
    await Promise.resolve();
  });
  expect(prepare).toHaveBeenCalledTimes(1);
});
it('ignores an older preparation response arriving after a newer version review', async () => {
  let finish: (value: unknown) => void = () => {};
  const prepare = jest
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    )
    .mockResolvedValue({ snapshot: { ...review, cartVersion: 4 } });
  useNativeSharedCartStore.setState({ prepareCheckoutReview: prepare });
  const { result } = renderHook(() => useCartCheckoutSnapshot());
  await waitFor(() => expect(prepare).toHaveBeenCalledTimes(1));
  act(() =>
    useNativeSharedCartStore.setState({
      snapshot: { ...cartSnapshot, version: 4 },
    })
  );
  await waitFor(() => expect(result.current.review?.cartVersion).toBe(4));
  await act(async () => finish({ snapshot: review }));
  expect(result.current.review?.cartVersion).toBe(4);
  expect(useNativeSharedCartStore.getState().checkoutReview?.cartVersion).toBe(
    4
  );
});
it('does not restore a pending review after the shared cart session is disabled', async () => {
  let finish: (value: unknown) => void = () => {};
  const prepare = jest.fn().mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  useNativeSharedCartStore.setState({ prepareCheckoutReview: prepare });
  const { result } = renderHook(() => useCartCheckoutSnapshot());
  await waitFor(() => expect(prepare).toHaveBeenCalled());
  act(() =>
    useNativeSharedCartStore.setState({
      enabled: false,
      snapshot: null,
      checkoutReview: null,
    })
  );
  await act(async () => finish({ snapshot: review }));
  expect(useNativeSharedCartStore.getState().checkoutReview).toBeNull();
  expect(result.current.binding).toBeNull();
});

it('prepares again when offer totals change at the same cart version', async () => {
  const prepare = jest.fn().mockResolvedValue({ snapshot: review });
  useNativeSharedCartStore.setState({ prepareCheckoutReview: prepare });
  const { result } = renderHook(() => useCartCheckoutSnapshot());
  await waitFor(() => expect(result.current.status).toBe('ready'));
  act(() =>
    useNativeSharedCartStore.setState({
      snapshot: { ...cartSnapshot, totalMinor: 200 },
    })
  );
  await waitFor(() => expect(prepare).toHaveBeenCalledTimes(2));
});
