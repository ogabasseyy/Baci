import { jest } from '@jest/globals';
import { StyleSheet } from 'react-native';

export {
  MIN_STICKY_BOTTOM_PADDING,
  PRODUCT_SCROLL_BOTTOM_PADDING,
} from '../../constants/product-layout';

import { baseProduct } from '../../lib/product-route/product-detail-screen.fixtures';

export const mockProductDetailsBody = jest.fn();
export const mockRouterReplace = jest.fn();
export const mockUseLocalSearchParams = jest.fn();
export const mockUseProduct = jest.fn();
export const mockUseEffectivePrice = jest.fn();
export const mockUseReviews = jest.fn();
export const mockUseCartStore = jest.fn();
export const mockValidatedUpdateQuantity = jest.fn();
export const mockValidatedAddToCart = jest.fn();
export const mockUseSavedStore = jest.fn();
export const mockProductImageGallery = jest.fn();
export const mockStickyBottomActions = jest.fn();
export const mockInsets = { top: 59, bottom: 34, left: 0, right: 0 };

export const mockCartStoreState = {
  items: [],
  addItem: jest.fn(),
  updateQuantity: jest.fn(),
  removeItem: jest.fn(),
};

const mockSavedStoreState = {
  toggleSaved: jest.fn(),
  isSaved: jest.fn(() => false),
  toastState: { show: false, type: 'add', message: '' },
  dismissToast: jest.fn(),
};

jest.mock('expo-router', () => ({
  router: {
    replace: (...args: unknown[]) => mockRouterReplace(...args),
    back: jest.fn(),
    push: jest.fn(),
    canGoBack: jest.fn(() => false),
  },
  Stack: {
    Screen: () => null,
  },
  useLocalSearchParams: (...args: unknown[]) =>
    mockUseLocalSearchParams(...args),
}));

jest.mock('react-native-reanimated', () => {
  const { View, ScrollView } =
    jest.requireActual<typeof import('react-native')>('react-native');

  return {
    __esModule: true,
    default: {
      View,
      ScrollView,
      createAnimatedComponent: (component: unknown) => component,
    },
    Extrapolate: { CLAMP: 'clamp' },
    FadeIn: { duration: () => ({}) },
    interpolate: () => 0,
    useAnimatedScrollHandler: () => jest.fn(),
    useAnimatedStyle: () => ({}),
    useSharedValue: () => ({ value: 0 }),
    withTiming: (value: unknown) => value,
  };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => mockInsets,
}));

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

jest.mock('@/components/OfflineNotice', () => ({
  OfflineEmptyState: () => null,
}));

jest.mock('@/components/product/FlyToCartParticle', () => ({
  FlyToCartParticle: () => null,
}));

jest.mock('@/components/product/ProductDetailsBody', () => ({
  ProductDetailsBody: (props: unknown) => {
    mockProductDetailsBody(props);
    return null;
  },
}));

jest.mock('@/components/product/ProductImageGallery', () => ({
  ProductImageGallery: (props: unknown) => {
    mockProductImageGallery(props);
    return null;
  },
}));

jest.mock('@/components/product/StickyBottomActions', () => ({
  StickyBottomActions: (props: unknown) => {
    mockStickyBottomActions(props);
    return null;
  },
}));

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));

jest.mock('@/hooks', () => ({
  useProduct: (...args: unknown[]) => mockUseProduct(...args),
}));

jest.mock('@/hooks/use-effective-price', () => ({
  useEffectivePrice: (...args: unknown[]) => mockUseEffectivePrice(...args),
}));

jest.mock('@/hooks/use-haptics', () => ({
  useHaptics: () => ({
    success: jest.fn(),
    light: jest.fn(),
  }),
}));

jest.mock('@/hooks/use-network-state', () => ({
  useNetworkState: () => ({ isOnline: true }),
}));

jest.mock('@/hooks/use-reviews', () => ({
  markReviewHelpful: jest.fn(),
  useReviews: (...args: unknown[]) => mockUseReviews(...args),
}));

jest.mock('@/stores/cart-store', () => ({
  useCartStore: (...args: unknown[]) => mockUseCartStore(...args),
}));

// PDP adds and quantity edits route through the validated useCart
// mutations, which need a QueryClient: stub them here so screen tests
// stay provider-free.
jest.mock('@/hooks/use-cart', () => ({
  useCart: () => ({
    updateQuantity: (...args: unknown[]) =>
      mockValidatedUpdateQuantity(...args),
    addToCart: (...args: unknown[]) => mockValidatedAddToCart(...args),
  }),
}));

jest.mock('@/stores/saved-store', () => ({
  useSavedStore: (...args: unknown[]) => mockUseSavedStore(...args),
}));

jest.mock('zustand/react/shallow', () => ({
  useShallow: (selector: unknown) => selector,
}));

const productDetailScreenModule = jest.requireActual<
  typeof import('../../app/product/[slug]')
>('../../app/product/[slug]');

export const ProductDetailScreen = productDetailScreenModule.default;

export type RenderedNode = {
  // react-test-renderer represents text content as raw strings interleaved
  // with element nodes — model that here so callers don't have to cast.
  children?: Array<RenderedNode | string> | null;
  props?: {
    contentContainerStyle?: unknown;
    style?: unknown;
  };
};

export function findNodeWithContentPadding(
  node: RenderedNode | RenderedNode[] | null,
  paddingBottom: number
): RenderedNode | null {
  if (!node) {
    return null;
  }

  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findNodeWithContentPadding(child, paddingBottom);
      if (match) {
        return match;
      }
    }
    return null;
  }

  const contentStyle = StyleSheet.flatten(node.props?.contentContainerStyle) as
    | { paddingBottom?: number }
    | undefined;
  if (contentStyle?.paddingBottom === paddingBottom) {
    return node;
  }

  for (const child of node.children ?? []) {
    if (typeof child === 'string') {
      continue;
    }
    const match = findNodeWithContentPadding(child, paddingBottom);
    if (match) {
      return match;
    }
  }

  return null;
}

export function getLastMockProps<T>(mockFn: { mock: { calls: unknown[][] } }) {
  return mockFn.mock.calls.at(-1)?.[0] as T | undefined;
}

export function resetProductDetailScreenMocks() {
  jest.clearAllMocks();
  mockUseLocalSearchParams.mockReturnValue({ slug: 'legacy-iphone-13-pro' });
  mockUseProduct.mockReturnValue({
    product: baseProduct,
    isLoading: false,
    error: null,
    refetch: jest.fn(),
  });
  mockUseEffectivePrice.mockReturnValue({
    price: baseProduct.price,
    comparePrice: undefined,
  });
  mockUseReviews.mockReturnValue({
    reviews: [],
    stats: null,
    isLoading: false,
    hasMore: false,
    loadMore: jest.fn(),
  });
  mockUseCartStore.mockImplementation((selector: unknown) =>
    (selector as (state: typeof mockCartStoreState) => unknown)(
      mockCartStoreState
    )
  );
  mockUseSavedStore.mockImplementation((selector: unknown) =>
    (selector as (state: typeof mockSavedStoreState) => unknown)(
      mockSavedStoreState
    )
  );
}
