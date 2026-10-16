import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import {
  buildAuthStatus,
  createMockCartState,
  mockAdSlotModule,
  mockAuthGuardModule,
  mockCartRepriceModule,
  mockCartStateHolder,
  mockCartStoreModule,
  mockCheckoutEntryPrefetchModule,
  mockCheckoutIdentityModule,
  mockColorSchemeModule,
  mockExpoRouterModule,
  mockHapticsModule,
  mockQueryClient,
  mockReactQueryModule,
  mockReanimatedModule,
  mockRouterBack,
  mockRouterCanGoBack,
  mockRouterPrefetch,
  mockRouterPush,
  mockRouterReplace,
  mockSafeAreaModule,
  mockSafeImageModule,
  mockShallowModule,
  mockUIStoreModule,
  mockUseAuthStatus,
  mockWarmCheckoutEntry,
  setupCartMocks,
} from './cart.test-utils';

jest.mock('expo-router', () => mockExpoRouterModule());
jest.mock('@tanstack/react-query', () => mockReactQueryModule());
jest.mock('@/components/checkout/checkout-entry-prefetch', () =>
  mockCheckoutEntryPrefetchModule()
);
jest.mock('@/components/cart/use-cart-reprice', () => mockCartRepriceModule());
jest.mock('@/components/ads/AdSlot', () => mockAdSlotModule());
jest.mock('expo-haptics', () => mockHapticsModule());
jest.mock('zustand/react/shallow', () => mockShallowModule());
jest.mock('react-native-reanimated', () => mockReanimatedModule());
jest.mock('@/components/useColorScheme', () => mockColorSchemeModule());
jest.mock('@/components/checkout/checkout-identity', () =>
  mockCheckoutIdentityModule()
);
jest.mock('@/components/ui/SafeImage', () => mockSafeImageModule());
jest.mock('@/stores/cart-store', () => mockCartStoreModule());
jest.mock('@/hooks/use-auth-guard', () => mockAuthGuardModule());
jest.mock('react-native-safe-area-context', () => mockSafeAreaModule());
jest.mock('@/stores/ui-store', () => mockUIStoreModule());

import CartScreen from '@/app/cart';
import { useNativeSharedCartStore } from '@/stores/native-shared-cart-store';

describe('CartScreen state', () => {
  beforeEach(() => {
    setupCartMocks();
    useNativeSharedCartStore.setState({ enabled: false, status: 'loading' });
  });

  it('renders empty cart state when there are no cart items', () => {
    mockCartStateHolder.current = createMockCartState({
      items: [],
      itemCount: () => 0,
      subtotal: () => 0,
    });

    render(<CartScreen />);

    expect(screen.getByText('Your cart is empty 🛒')).toBeTruthy();
    expect(screen.getByText('Start Shopping')).toBeTruthy();
    expect(screen.queryByText('Lenovo ThinkPad E16 Gen 2')).toBeNull();
  });

  it('mounts the saved-account loader on the empty cart state', async () => {
    mockCartStateHolder.current = createMockCartState({
      items: [],
      itemCount: () => 0,
      subtotal: () => 0,
    });
    const loadSavedCart = jest.fn(async () => undefined);
    useNativeSharedCartStore.setState({
      accountsEnabled: true,
      accountUserId: 'user-1',
      enabled: true,
      linkAccount: jest.fn(async () => undefined) as never,
      loadSavedCart: loadSavedCart as never,
      metadataReady: true,
      savedCart: null,
      snapshot: { cartId: 'cart-1', lines: [] } as never,
      status: 'ready',
    });
    render(<CartScreen />);
    expect(screen.getByText('Your cart is empty 🛒')).toBeTruthy();
    await waitFor(() => expect(loadSavedCart).toHaveBeenCalled());
    expect(screen.getByText('Save this cart to your account')).toBeTruthy();
  });

  it('reacts when the shared cart is enabled without a status change', () => {
    mockCartStateHolder.current = createMockCartState({
      items: [],
      itemCount: () => 0,
      subtotal: () => 0,
    });
    useNativeSharedCartStore.setState({
      enabled: false,
      status: 'choice_required',
    });
    render(<CartScreen />);
    expect(screen.getByText('Your cart is empty 🛒')).toBeTruthy();
    act(() => useNativeSharedCartStore.setState({ enabled: true }));
    expect(screen.queryByText('Your cart is empty 🛒')).toBeNull();
    expect(
      screen.getByText(
        'You have a saved cart and items on this device. Choose which cart to use.'
      )
    ).toBeTruthy();
  });

  it('renders cart error state when cart data is unavailable', () => {
    mockCartStateHolder.current = {
      items: undefined,
      itemCount: undefined,
      subtotal: undefined,
      updateQuantity: undefined,
      removeItem: undefined,
      clearCart: undefined,
      toggleAssurance: undefined,
    };

    render(<CartScreen />);

    expect(screen.getByText('Unable to load cart')).toBeTruthy();
    expect(screen.getByText('Retry')).toBeTruthy();
    expect(screen.queryByText('Lenovo ThinkPad E16 Gen 2')).toBeNull();
  });

  it('opens guest identity modal for guests and routes signed-in users straight to checkout', () => {
    const { rerender } = render(<CartScreen />);

    fireEvent.press(
      screen.getByRole('button', { name: /Proceed to checkout, total/i })
    );

    expect(screen.getByText('Checkout Identity Modal')).toBeTruthy();
    expect(mockRouterPush).not.toHaveBeenCalled();

    mockUseAuthStatus.mockReturnValue(
      buildAuthStatus({
        isAuthenticated: true,
        isGuest: false,
        user: { id: 'user-1' },
      })
    );

    rerender(<CartScreen />);
    jest.clearAllMocks();
    const checkoutButton = screen.getByRole('button', {
      name: /Proceed to checkout, total/i,
    });
    fireEvent(checkoutButton, 'pressIn');
    fireEvent.press(checkoutButton);

    expect(mockRouterPrefetch).toHaveBeenCalledWith('/checkout');
    expect(mockWarmCheckoutEntry).toHaveBeenCalledWith(mockQueryClient);
    expect(mockRouterPush).toHaveBeenCalledWith('/checkout');
  });

  it('does not warm checkout data while a populated cart is open', () => {
    render(<CartScreen />);

    expect(mockRouterPrefetch).not.toHaveBeenCalled();
    expect(mockWarmCheckoutEntry).not.toHaveBeenCalled();
  });

  it('falls back to home replacement when the cart header has no back stack', () => {
    render(<CartScreen />);

    fireEvent.press(screen.getByRole('button', { name: 'Back to home' }));

    expect(mockRouterCanGoBack).toHaveBeenCalledTimes(1);
    expect(mockRouterBack).not.toHaveBeenCalled();
    expect(mockRouterReplace).toHaveBeenCalledWith('/');
  });

  it('preserves deep navigation history when the cart header can go back', () => {
    mockRouterCanGoBack.mockReturnValue(true);

    render(<CartScreen />);

    fireEvent.press(screen.getByRole('button', { name: 'Back to home' }));

    expect(mockRouterBack).toHaveBeenCalledTimes(1);
    expect(mockRouterReplace).not.toHaveBeenCalledWith('/');
  });
});
