import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, render, screen } from '@testing-library/react-native';
import { Share } from 'react-native';
import Colors from '@/constants/Colors';
import { baseProduct } from '@/lib/product-route/product-detail-screen.fixtures';
import { ProductDetailScreen } from './ProductDetailScreen';

type ProductDetailScreenProps = React.ComponentProps<
  typeof ProductDetailScreen
>;

function createRefetch(): ProductDetailScreenProps['refetch'] {
  return async () =>
    ({
      data: baseProduct,
    }) as Awaited<ReturnType<ProductDetailScreenProps['refetch']>>;
}

const mockProductDetailLoadedView = jest.fn();
const mockProductDetailRouteState = jest.fn();
const mockUseProductDetailRouteData = jest.fn();
const mockUseProductDetailAnimations = jest.fn();
const mockUseProductDetailCartState = jest.fn();
const mockUseProductDetailPurchaseState = jest.fn();
const mockUseProductDetailCartActions = jest.fn();
const mockUseProductDetailSelectionHandlers = jest.fn();
const mockUseSavedToastAutoDismiss = jest.fn();
const mockUseSavedStore = jest.fn();
const mockToggleSaved = jest.fn();
const mockIsSaved = jest.fn(() => false);
const mockDismissToast = jest.fn();
const mockTrackProductRouteWishlistAdd = jest.fn();
const mockMarkReviewHelpful = jest.fn();
const mockInsets = { top: 44, bottom: 34, left: 0, right: 0 };

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => mockInsets,
}));

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    error: jest.fn(),
    info: jest.fn(),
  }),
}));

jest.mock('@/hooks/use-reviews', () => ({
  markReviewHelpful: (...args: unknown[]) => mockMarkReviewHelpful(...args),
}));

jest.mock('@/services/tiktok-product-route-tracking', () => ({
  trackProductRouteWishlistAdd: (...args: unknown[]) =>
    mockTrackProductRouteWishlistAdd(...args),
}));

jest.mock('@/stores/saved-store', () => ({
  useSavedStore: (selector: unknown) => mockUseSavedStore(selector),
}));

jest.mock('./hooks/use-product-detail-route-data', () => ({
  useProductDetailRouteData: (args: unknown) =>
    mockUseProductDetailRouteData(args),
}));

jest.mock('./hooks/use-product-detail-animations', () => ({
  useProductDetailAnimations: (colors: unknown) =>
    mockUseProductDetailAnimations(colors),
}));

jest.mock('./hooks/use-product-detail-cart-state', () => ({
  useProductDetailCartState: (routeData: unknown) =>
    mockUseProductDetailCartState(routeData),
}));

jest.mock('./hooks/use-product-detail-purchase-state', () => ({
  useProductDetailPurchaseState: (...args: unknown[]) =>
    mockUseProductDetailPurchaseState(...args),
}));

jest.mock('./hooks/use-product-detail-cart-actions', () => ({
  useProductDetailCartActions: (...args: unknown[]) =>
    mockUseProductDetailCartActions(...args),
}));

jest.mock('./hooks/use-product-detail-selection-handlers', () => ({
  useProductDetailSelectionHandlers: (routeData: unknown) =>
    mockUseProductDetailSelectionHandlers(routeData),
}));

jest.mock('./hooks/use-saved-toast-auto-dismiss', () => ({
  useSavedToastAutoDismiss: (...args: unknown[]) =>
    mockUseSavedToastAutoDismiss(...args),
}));

jest.mock('./ProductDetailLoadedView', () => {
  const { Text } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');

  return {
    ProductDetailLoadedView: (props: unknown) => {
      mockProductDetailLoadedView(props);
      return <Text>Loaded product detail</Text>;
    },
  };
});

jest.mock('./ProductDetailRouteState', () => {
  const { Text } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');

  return {
    ProductDetailRouteState: (props: unknown) => {
      mockProductDetailRouteState(props);
      return <Text>Route state</Text>;
    },
  };
});

function createRouteData(overrides: Record<string, unknown> = {}) {
  return {
    availableConditions: [],
    displayProduct: baseProduct,
    effectiveSelectedAttributes: {},
    effectiveSelectedColor: null,
    effectiveSelectedCondition: null,
    effectiveSelectedStorage: null,
    error: null,
    isLoading: false,
    isOnline: true,
    isValidSlug: true,
    product: baseProduct,
    productGalleryImages: [baseProduct.image],
    refetch: jest.fn(),
    reviewsState: {
      hasMore: false,
      isLoading: false,
      loadMore: jest.fn(),
      reviews: [],
      stats: null,
    },
    selectedImageIndex: 0,
    selectedVariant: null,
    ...overrides,
  };
}

function setupLoadedRoute() {
  // productQuantityInCart differs from quantityInCart so the purchase
  // hook forwarding assertion proves which value is passed.
  const cartState = { quantityInCart: 1, productQuantityInCart: 2 };
  const purchaseState = {
    canPurchase: true,
    conditionOffersForDisplay: [],
    effectiveComparePrice: undefined,
    effectivePrice: baseProduct.price,
  };
  const cartActions = {
    flyingParticles: [],
    handleAddToCart: jest.fn(),
    handleLocalQtyBlur: jest.fn(),
    handleLocalQtyChange: jest.fn(),
    handleUpdateQuantity: jest.fn(),
    localQty: '1',
    showAddedToast: false,
  };
  const selectionHandlers = {
    handleSelectImageIndex: jest.fn(),
    onSelectAttribute: jest.fn(),
    onSelectColor: jest.fn(),
    onSelectCondition: jest.fn(),
    onSelectStorage: jest.fn(),
    onSetSelectedVariant: jest.fn(),
  };

  mockUseProductDetailRouteData.mockReturnValue(createRouteData());
  mockUseProductDetailAnimations.mockReturnValue({
    backButtonAnimatedStyle: {},
    headerAnimatedStyle: {},
    headerHeight: 320,
    imageAnimatedStyle: {},
    onScroll: jest.fn(),
  });
  mockUseProductDetailCartState.mockReturnValue(cartState);
  mockUseProductDetailPurchaseState.mockReturnValue(purchaseState);
  mockUseProductDetailCartActions.mockReturnValue(cartActions);
  mockUseProductDetailSelectionHandlers.mockReturnValue(selectionHandlers);

  return { cartActions, cartState, purchaseState, selectionHandlers };
}

describe('ProductDetailScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupLoadedRoute();
    mockToggleSaved.mockClear();
    mockIsSaved.mockReturnValue(false);
    mockUseSavedStore.mockImplementation((selector: unknown) =>
      (selector as (state: unknown) => unknown)({
        dismissToast: mockDismissToast,
        isSaved: mockIsSaved,
        toastState: { show: false, type: 'add', message: '' },
        toggleSaved: mockToggleSaved,
      })
    );
  });

  it('renders route state for invalid, loading, offline, and error states', () => {
    mockUseProductDetailRouteData.mockReturnValueOnce(
      createRouteData({ isValidSlug: false })
    );
    const invalid = render(
      <ProductDetailScreen
        error={null}
        isLoading={false}
        product={baseProduct}
        refetch={createRefetch()}
      />
    );
    expect(mockProductDetailRouteState).toHaveBeenLastCalledWith(
      expect.objectContaining({ state: 'invalid' })
    );
    invalid.unmount();

    mockUseProductDetailRouteData.mockReturnValueOnce(
      createRouteData({ isLoading: true, product: null })
    );
    const loading = render(
      <ProductDetailScreen
        error={null}
        isLoading
        product={null}
        refetch={createRefetch()}
      />
    );
    expect(mockProductDetailRouteState).toHaveBeenLastCalledWith(
      expect.objectContaining({ state: 'loading' })
    );
    loading.unmount();

    mockUseProductDetailRouteData.mockReturnValueOnce(
      createRouteData({ error: 'offline', isOnline: false, product: null })
    );
    const offline = render(
      <ProductDetailScreen
        error="offline"
        isLoading={false}
        product={null}
        refetch={createRefetch()}
      />
    );
    expect(mockProductDetailRouteState).toHaveBeenLastCalledWith(
      expect.objectContaining({ state: 'offline' })
    );
    offline.unmount();

    mockUseProductDetailRouteData.mockReturnValueOnce(
      createRouteData({ error: 'not found', product: null })
    );
    render(
      <ProductDetailScreen
        error="not found"
        isLoading={false}
        product={null}
        refetch={createRefetch()}
      />
    );
    expect(mockProductDetailRouteState).toHaveBeenLastCalledWith(
      expect.objectContaining({ state: 'error' })
    );
  });

  it('passes derived product data into the loaded view', () => {
    render(
      <ProductDetailScreen
        error={null}
        isLoading={false}
        product={baseProduct}
        refetch={createRefetch()}
      />
    );

    expect(screen.getByText('Loaded product detail')).toBeTruthy();
    expect(mockUseSavedToastAutoDismiss).toHaveBeenCalledWith(
      false,
      mockDismissToast
    );
    expect(mockProductDetailLoadedView).toHaveBeenCalledWith(
      expect.objectContaining({
        colors: Colors.light,
        insets: mockInsets,
        isSaved: false,
        product: baseProduct,
      })
    );
    expect(mockProductDetailLoadedView).toHaveBeenCalledWith(
      expect.objectContaining({
        bodyProps: expect.objectContaining({
          effectivePrice: baseProduct.price,
          product: baseProduct,
        }),
        galleryProps: expect.objectContaining({
          images: [baseProduct.image],
          selectedImageIndex: 0,
        }),
        stickyProps: expect.objectContaining({
          quantityInCart: 1,
        }),
      })
    );

    // Negotiation now lives in the cart, so the PDP prices with no negotiated
    // override (null) rather than a PDP-level negotiated price. The
    // product-wide cart quantity follows as the fourth argument for the
    // strict-pool cap.
    expect(mockUseProductDetailPurchaseState).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      null,
      2
    );
  });

  it('tracks wishlist adds and shares product links from loaded view callbacks', async () => {
    jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: Share.sharedAction });

    render(
      <ProductDetailScreen
        error={null}
        isLoading={false}
        product={baseProduct}
        refetch={createRefetch()}
      />
    );

    const loadedProps = mockProductDetailLoadedView.mock.calls.at(-1)?.[0] as {
      onShare: () => Promise<void>;
      onWishlistPress: () => void;
    };

    loadedProps.onWishlistPress();
    await act(async () => {
      await loadedProps.onShare();
    });

    expect(mockToggleSaved).toHaveBeenCalledWith(baseProduct);
    expect(mockTrackProductRouteWishlistAdd).toHaveBeenCalledWith(
      baseProduct,
      baseProduct.price
    );
    expect(Share.share).toHaveBeenCalledWith({
      message: `Check out the ${baseProduct.name} on Ogabassey: https://ogabassey.com/product/${baseProduct.slug}`,
      title: baseProduct.name,
    });
  });
});
