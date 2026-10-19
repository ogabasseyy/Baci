import { render } from '@testing-library/react-native';
import type { ComponentProps } from 'react';
import type { Product } from '@/types/product';
import { ProductCard } from './ProductCard';
import type GridProductCard from './product-card/GridProductCard';

jest.mock('react-native/Libraries/Utilities/PixelRatio', () => {
  const actual = jest.requireActual<{ default: object }>(
    'react-native/Libraries/Utilities/PixelRatio'
  );
  const mocked = Object.create(actual.default);
  Object.defineProperty(mocked, 'get', { value: () => 2 });
  return { __esModule: true, default: mocked };
});
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ fontScale: 1, height: 800, scale: 2, width: 400 }),
}));

const mockGridProductCard = jest.fn(
  (_props: ComponentProps<typeof GridProductCard>) => null
);
const mockEditorialProductCard = jest.fn((_props: unknown) => null);
const mockListProductCard = jest.fn((_props: unknown) => null);
const mockAddItem = jest.fn();

jest.mock('./product-card/GridProductCard', () => ({
  __esModule: true,
  default: (props: ComponentProps<typeof GridProductCard>) =>
    mockGridProductCard(props),
}));
jest.mock('./product-card/EditorialProductCard', () => ({
  __esModule: true,
  default: (props: unknown) => mockEditorialProductCard(props),
}));
jest.mock('./product-card/ListProductCard', () => ({
  __esModule: true,
  default: (props: unknown) => mockListProductCard(props),
}));
jest.mock('@/hooks/use-haptics', () => ({
  useHaptics: () => ({ light: jest.fn() }),
}));
jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));
jest.mock('@/stores/cart-store', () => ({
  selectCartQuantities: () => new Map(),
  useCartStore: (selector: (state: { addItem: jest.Mock }) => unknown) =>
    selector({ addItem: mockAddItem }),
}));
jest.mock('@/stores/saved-store', () => ({
  selectSavedProductIds: () => new Set(),
  useSavedStore: (selector: (state: { toggleSaved: jest.Mock }) => unknown) =>
    selector({ toggleSaved: jest.fn() }),
}));
jest.mock('./product-card-tracking', () => ({
  trackCartAdd: jest.fn(),
  trackWishlistAdd: jest.fn(),
}));

const product: Product = {
  id: 'product-1',
  image: 'https://cdn.example.com/large-product.avif',
  name: 'Large Product Image',
  price: 100_000,
  slug: 'large-product-image',
};

describe('ProductCard image memory behavior', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('bounds grid image decoding to the physical viewport size', () => {
    render(<ProductCard product={product} />);

    expect(mockGridProductCard).toHaveBeenCalledWith(
      expect.objectContaining({
        imageProps: expect.objectContaining({
          allowDownscaling: true,
          enforceEarlyResizing: true,
        }),
        imageSource: {
          height: 352,
          uri: product.image,
          width: 352,
        },
      })
    );
  });

  it('uses a static CDN fallback for managed AVIF catalog images', () => {
    render(
      <ProductCard
        product={{
          ...product,
          image: 'https://cdn.ogabassey.com/core-assets/products/phone.avif',
        }}
      />
    );

    expect(mockGridProductCard).toHaveBeenCalledWith(
      expect.objectContaining({
        imageSource: {
          height: 352,
          uri: 'https://cdn.ogabassey.com/image/width=352,height=352,quality=82,format=webp,fit=cover/core-assets/products/phone.avif',
          width: 352,
        },
      })
    );
  });

  it('persists the original managed image when a product is quick-added', () => {
    render(
      <ProductCard
        product={{
          ...product,
          image: 'https://cdn.ogabassey.com/core-assets/products/phone.avif',
        }}
      />
    );

    const gridProps = mockGridProductCard.mock.calls.at(-1)?.[0];
    gridProps?.handleAddToCart();

    expect(mockAddItem).toHaveBeenCalledWith(
      expect.objectContaining({
        image_url: 'https://cdn.ogabassey.com/core-assets/products/phone.avif',
      })
    );
  });

  it('bounds list image decoding to the fixed physical image size', () => {
    render(<ProductCard product={product} variant="list" />);

    expect(mockListProductCard).toHaveBeenCalledWith(
      expect.objectContaining({
        imageSource: {
          height: 200,
          uri: product.image,
          width: 200,
        },
      })
    );
  });

  it('bounds editorial decoding to its physical portrait dimensions', () => {
    render(<ProductCard product={product} variant="editorial" />);

    expect(mockEditorialProductCard).toHaveBeenCalledWith(
      expect.objectContaining({
        imageSource: {
          height: 920,
          uri: product.image,
          width: 736,
        },
      })
    );
  });
});
