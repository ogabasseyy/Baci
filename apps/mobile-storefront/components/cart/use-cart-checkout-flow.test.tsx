import { act, renderHook } from '@testing-library/react-native';

let mockIsFocused = true;
let mockIsIdentityOpen = false;
const mockRouterPush = jest.fn();
const mockOpenIdentity = jest.fn();
const mockCloseIdentity = jest.fn();
const mockRecoverCheckout = jest.fn(async (_onReady?: () => void) => {});
const mockVerified = jest.fn();
let mockOnReady: (() => void) | undefined;

jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockRouterPush(...args) },
  useIsFocused: () => mockIsFocused,
}));
jest.mock(
  '@/components/checkout/checkout-identity/useCheckoutIdentityOverlay',
  () => ({
    useCheckoutIdentityOverlay: () => ({
      isOpen: mockIsIdentityOpen,
      open: (...args: unknown[]) => mockOpenIdentity(...args),
      close: () => mockCloseIdentity(),
    }),
  })
);
jest.mock('./use-cart-checkout-recovery', () => ({
  useCartCheckoutRecovery: (onReady: () => void) => {
    mockOnReady = onReady;
    return { recoverCheckout: mockRecoverCheckout, isPreparing: false };
  },
}));
jest.mock('./use-cart-checkout-identity-recovery', () => ({
  useCartCheckoutIdentityRecovery: () => mockVerified,
}));

import { useCartCheckoutFlow } from './use-cart-checkout-flow';

beforeEach(() => {
  mockIsFocused = true;
  mockIsIdentityOpen = false;
  mockOnReady = undefined;
  mockRouterPush.mockClear();
  mockOpenIdentity.mockClear();
  mockCloseIdentity.mockClear();
  mockRecoverCheckout.mockClear();
  mockVerified.mockClear();
});

it('blocks checkout while repricing needs review', () => {
  renderHook(() =>
    useCartCheckoutFlow({ isAuthenticated: false, isPriceChangeVisible: true })
  );

  act(() => mockOnReady?.());

  expect(mockOpenIdentity).not.toHaveBeenCalled();
  expect(mockRouterPush).not.toHaveBeenCalled();
});

it('revalidates the cart before continuing as guest', () => {
  mockRecoverCheckout.mockImplementation(async (onReady) => {
    onReady?.();
  });
  renderHook(() =>
    useCartCheckoutFlow({ isAuthenticated: false, isPriceChangeVisible: false })
  );

  act(() => mockOnReady?.());
  expect(mockOpenIdentity).toHaveBeenCalledWith(
    mockVerified,
    expect.any(Function)
  );

  const onGuestCheckout = mockOpenIdentity.mock.calls[0]?.[1] as
    | (() => void)
    | undefined;
  act(() => onGuestCheckout?.());

  expect(mockRecoverCheckout).toHaveBeenCalledWith(expect.any(Function));
  expect(mockRouterPush).toHaveBeenCalledWith('/checkout');
});

it('keeps a deferred reprice review fenced after the identity sheet opens', () => {
  mockRecoverCheckout.mockImplementation(async (onReady) => {
    onReady?.();
  });
  const { rerender } = renderHook(
    ({ isPriceChangeVisible }: { isPriceChangeVisible: boolean }) =>
      useCartCheckoutFlow({
        isAuthenticated: false,
        isPriceChangeVisible,
      }),
    { initialProps: { isPriceChangeVisible: false } }
  );

  act(() => mockOnReady?.());
  const onGuestCheckout = mockOpenIdentity.mock.calls[0]?.[1] as
    | (() => void)
    | undefined;
  rerender({ isPriceChangeVisible: true });
  act(() => onGuestCheckout?.());

  expect(mockRecoverCheckout).toHaveBeenCalledWith(expect.any(Function));
  expect(mockRouterPush).not.toHaveBeenCalled();
});

it('keeps authenticated checkout fenced when reprice appears during recovery', () => {
  const { rerender } = renderHook(
    ({ isPriceChangeVisible }: { isPriceChangeVisible: boolean }) =>
      useCartCheckoutFlow({ isAuthenticated: true, isPriceChangeVisible }),
    { initialProps: { isPriceChangeVisible: false } }
  );

  const checkoutReady = mockOnReady;
  rerender({ isPriceChangeVisible: true });
  act(() => checkoutReady?.());

  expect(mockRouterPush).not.toHaveBeenCalled();
});

it('does not close an overlay owned by another unfocused cart route', () => {
  mockIsFocused = false;
  mockIsIdentityOpen = true;

  renderHook(() =>
    useCartCheckoutFlow({ isAuthenticated: false, isPriceChangeVisible: false })
  );

  expect(mockCloseIdentity).not.toHaveBeenCalled();
});

it('closes its own overlay when the route loses focus', () => {
  const { rerender } = renderHook(
    ({ isFocused }: { isFocused: boolean }) => {
      mockIsFocused = isFocused;
      return useCartCheckoutFlow({
        isAuthenticated: false,
        isPriceChangeVisible: false,
      });
    },
    { initialProps: { isFocused: true } }
  );

  act(() => mockOnReady?.());
  mockIsIdentityOpen = true;
  rerender({ isFocused: false });

  expect(mockCloseIdentity).toHaveBeenCalledTimes(1);
});

it('closes its own overlay if the cart becomes empty', () => {
  const { rerender } = renderHook(
    ({ hasCart }: { hasCart: boolean }) =>
      useCartCheckoutFlow({
        isAuthenticated: false,
        isPriceChangeVisible: false,
        hasCart,
      }),
    { initialProps: { hasCart: true } }
  );

  act(() => mockOnReady?.());
  mockIsIdentityOpen = true;
  rerender({ hasCart: false });

  expect(mockCloseIdentity).toHaveBeenCalledTimes(1);
});

it('closes its owned overlay when the cart route unmounts', () => {
  const { unmount } = renderHook(() =>
    useCartCheckoutFlow({ isAuthenticated: false, isPriceChangeVisible: false })
  );

  act(() => mockOnReady?.());
  mockIsIdentityOpen = true;
  expect(mockOpenIdentity).toHaveBeenCalledTimes(1);
  unmount();

  expect(mockCloseIdentity).toHaveBeenCalledTimes(1);
});
