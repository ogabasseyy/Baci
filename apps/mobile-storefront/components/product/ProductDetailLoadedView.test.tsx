import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { MIN_STICKY_BOTTOM_PADDING } from '@/constants/product-layout';
import { baseProduct } from '@/lib/product-route/product-detail-screen.fixtures';
import { ProductDetailLoadedView } from './ProductDetailLoadedView';

const mockRouterBack = jest.fn();
const mockRouterReplace = jest.fn();
const mockRouterCanGoBack = jest.fn(() => false);
const mockProductDetailsBody = jest.fn();
const mockProductImageGallery = jest.fn();
const mockStickyBottomActions = jest.fn();
const mockFlyToCartParticle = jest.fn();

jest.mock('expo-router', () => ({
  router: {
    back: () => mockRouterBack(),
    replace: (path: string) => mockRouterReplace(path),
    canGoBack: () => mockRouterCanGoBack(),
  },
  Stack: { Screen: () => null },
}));

jest.mock('@react-native-vector-icons/ionicons', () => {
  const { Text } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');

  return function MockIonicons({ name }: { name: string }) {
    return <Text>{name}</Text>;
  };
});

jest.mock('react-native-reanimated', () => {
  const { ScrollView, View } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');

  return {
    __esModule: true,
    default: { ScrollView, View },
    FadeIn: { duration: () => ({}) },
  };
});

jest.mock('@/components/product/ProductDetailsBody', () => {
  const { Text } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');

  return {
    ProductDetailsBody: (props: unknown) => {
      mockProductDetailsBody(props);
      return <Text>Product body</Text>;
    },
  };
});

jest.mock('@/components/product/ProductImageGallery', () => {
  const { Text } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');

  return {
    ProductImageGallery: (props: unknown) => {
      mockProductImageGallery(props);
      return <Text>Product gallery</Text>;
    },
  };
});

jest.mock('@/components/product/StickyBottomActions', () => {
  const { Text } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');

  return {
    StickyBottomActions: (props: unknown) => {
      mockStickyBottomActions(props);
      return <Text>Sticky actions</Text>;
    },
  };
});

jest.mock('@/components/product/FlyToCartParticle', () => {
  const { View } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');

  return {
    FlyToCartParticle: (props: unknown) => {
      mockFlyToCartParticle(props);
      return <View testID="fly-to-cart-particle" />;
    },
  };
});

function createProps(
  overrides: Partial<React.ComponentProps<typeof ProductDetailLoadedView>> = {}
): React.ComponentProps<typeof ProductDetailLoadedView> {
  return {
    backButtonAnimatedStyle: { opacity: 1 },
    bodyProps: { product: baseProduct } as React.ComponentProps<
      typeof ProductDetailLoadedView
    >['bodyProps'],
    colors: Colors.light,
    flyingParticles: [],
    galleryProps: { images: [baseProduct.image] } as React.ComponentProps<
      typeof ProductDetailLoadedView
    >['galleryProps'],
    headerAnimatedStyle: { opacity: 1 },
    insets: { top: 44, bottom: 34, left: 0, right: 0 },
    isSaved: false,
    onScroll: jest.fn(),
    onShare: jest.fn(),
    onWishlistPress: jest.fn(),
    product: baseProduct,
    savedToastState: { show: false, type: 'add', message: '' },
    showAddedToast: false,
    stickyProps: {
      canPurchase: true,
      colors: Colors.light,
      localQty: '1',
      onAddToCart: jest.fn(),
      onDecrement: jest.fn(),
      onIncrement: jest.fn(),
      onLocalQtyBlur: jest.fn(),
      onLocalQtyChange: jest.fn(),
      quantityInCart: 0,
    } as React.ComponentProps<typeof ProductDetailLoadedView>['stickyProps'],
    ...overrides,
  };
}

describe('ProductDetailLoadedView', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouterCanGoBack.mockReturnValue(false);
  });

  it('renders loaded product chrome and forwards body, gallery, and sticky props', () => {
    const insets = { top: 44, bottom: 34, left: 19, right: 41 };
    render(<ProductDetailLoadedView {...createProps({ insets })} />);

    expect(screen.getByText(baseProduct.name)).toBeTruthy();
    expect(screen.getByText('Product gallery')).toBeTruthy();
    expect(screen.getByText('Product body')).toBeTruthy();
    expect(screen.getByText('Sticky actions')).toBeTruthy();
    expect(screen.getByTestId('product-detail-header-actions')).toHaveStyle({
      left: 19,
      right: 41,
    });
    expect(mockProductImageGallery).toHaveBeenCalledWith(
      expect.objectContaining({ images: [baseProduct.image] })
    );
    expect(mockProductDetailsBody).toHaveBeenCalledWith(
      expect.objectContaining({ product: baseProduct })
    );
    expect(mockStickyBottomActions).toHaveBeenCalledWith(
      expect.objectContaining({
        horizontalInsets: insets,
        paddingBottom: Math.max(34, MIN_STICKY_BOTTOM_PADDING),
      })
    );
  });

  it('uses fallback home navigation when the back stack is empty', () => {
    render(<ProductDetailLoadedView {...createProps()} />);

    fireEvent.press(screen.getByRole('button', { name: 'Go back' }));

    expect(mockRouterReplace).toHaveBeenCalledWith('/');
    expect(mockRouterBack).not.toHaveBeenCalled();
  });

  it('uses router back when a back stack is available', () => {
    mockRouterCanGoBack.mockReturnValue(true);

    render(<ProductDetailLoadedView {...createProps()} />);

    fireEvent.press(screen.getByRole('button', { name: 'Go back' }));

    expect(mockRouterBack).toHaveBeenCalledTimes(1);
    expect(mockRouterReplace).not.toHaveBeenCalled();
  });

  it('wires wishlist, share, particles, and toast affordances', () => {
    const onWishlistPress = jest.fn();
    const onShare = jest.fn();

    render(
      <ProductDetailLoadedView
        {...createProps({
          flyingParticles: [{ id: 1, startX: 10, startY: 20 }],
          isSaved: true,
          onShare,
          onWishlistPress,
          savedToastState: {
            show: true,
            type: 'remove',
            message: 'Removed from saved items',
          },
          showAddedToast: true,
        })}
      />
    );

    fireEvent.press(
      screen.getByRole('button', {
        name: `Remove ${baseProduct.name} from saved items`,
      })
    );
    fireEvent.press(screen.getByRole('button', { name: 'Share this product' }));

    expect(onWishlistPress).toHaveBeenCalledTimes(1);
    expect(onShare).toHaveBeenCalledTimes(1);
    expect(mockFlyToCartParticle).toHaveBeenCalledWith({
      startX: 10,
      startY: 20,
    });
    expect(screen.getByText('Added to your cart!')).toBeTruthy();
    expect(screen.getByText('Removed from saved items')).toBeTruthy();
  });
});
