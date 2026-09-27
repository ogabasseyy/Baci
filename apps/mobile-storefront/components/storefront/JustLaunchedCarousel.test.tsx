import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import {
  a27,
  mockExpoImageModule,
  mockImage,
  mockPush,
  mockReactNativeModule,
  mockSkeletonModule,
  mockThemeModule,
  mockUseMobileAdsReadiness,
  mockUsePinned,
  mockUseProducts,
  setupCarouselMocks,
  xiaomi,
} from './JustLaunchedCarousel-test-harness';

jest.mock('@/hooks/use-mobile-ads-readiness', () => ({
  useMobileAdsReadiness: mockUseMobileAdsReadiness,
}));
jest.mock('@/services/analytics-core', () => ({
  trackEvent: jest.fn(),
}));
jest.mock('react-native-google-mobile-ads', () => ({
  BannerAd: 'BannerAd',
  BannerAdSize: {
    ANCHORED_ADAPTIVE_BANNER: 'anchored-adaptive-banner',
  },
}));
jest.mock('expo-image', () => mockExpoImageModule());
jest.mock('react-native', () => mockReactNativeModule());
jest.mock('expo-router', () => ({
  router: { push: (path: string) => mockPush(path) },
  useIsFocused: () => true,
}));
jest.mock('@/hooks/useTheme', () => mockThemeModule());
jest.mock('@/hooks/use-products', () => ({
  useProducts: () => mockUseProducts(),
}));
jest.mock('@/hooks/use-pinned-launch-products', () => ({
  usePinnedLaunchProducts: () => mockUsePinned(),
}));
jest.mock('@/components/ui/Skeleton', () => mockSkeletonModule());

import { PRODUCT_PLACEHOLDER_IMAGE } from '@/lib/product-normalization';
import { JustLaunchedCarousel } from './JustLaunchedCarousel';

describe('JustLaunchedCarousel', () => {
  beforeEach(() => {
    setupCarouselMocks();
  });

  it('renders pinned-first slides and navigates to the product on press', () => {
    mockUsePinned.mockReturnValue({ data: [a27] });
    mockUseProducts.mockReturnValue({
      products: [xiaomi, a27],
      isLoading: false,
      isError: false,
    });

    render(<JustLaunchedCarousel />);

    expect(screen.getByText('Samsung Galaxy A27 5G Preorder')).toBeTruthy();
    expect(screen.getByText('Xiaomi 17T')).toBeTruthy();
    // Pre-order-aware CTA from the shared helper.
    expect(screen.getByText('Pre-order now')).toBeTruthy();

    fireEvent.press(
      screen.getByRole('button', { name: /Samsung Galaxy A27 5G Preorder/ })
    );
    expect(mockPush).toHaveBeenCalledWith('/product/samsung-galaxy-a27-5g');
  });

  it('bounds Android decoding and requests iOS early resizing for launch images', () => {
    mockUseProducts.mockReturnValue({
      products: [xiaomi],
      isLoading: false,
      isError: false,
    });

    render(<JustLaunchedCarousel />);

    expect(mockImage).toHaveBeenCalledWith(
      expect.objectContaining({
        enforceEarlyResizing: true,
        source: {
          height: 304,
          uri: 'https://cdn.ogabassey.com/image/width=244,height=304,quality=82,format=webp/core-assets/products/xiaomi.avif',
          width: 244,
        },
      })
    );
  });

  it('uses the shared cutoff-adjusted launch order when newer arrivals exist', () => {
    const newArrival = {
      ...xiaomi,
      id: 'new-xiaomi',
      slug: 'xiaomi-18-ultra',
      name: 'Xiaomi 18 Ultra',
      created_at: '2026-06-24T08:00:00.000Z',
    };
    mockUsePinned.mockReturnValue({ data: [a27] });
    mockUseProducts.mockReturnValue({
      products: [newArrival, xiaomi, a27],
      isLoading: false,
      isError: false,
    });

    render(<JustLaunchedCarousel />);

    const buttons = screen.getAllByRole('button');
    expect(buttons[0]?.props.accessibilityLabel).toContain('Xiaomi 18 Ultra');
    expect(buttons[1]?.props.accessibilityLabel).toContain(
      'Samsung Galaxy A27 5G Preorder'
    );
  });

  it('skips launch rows that cannot render an image', () => {
    mockUseProducts.mockReturnValue({
      products: [
        {
          id: 'missing-image',
          name: 'Image Missing Phone',
          slug: 'image-missing-phone',
          price: 500000,
        },
        xiaomi,
      ],
      isLoading: false,
      isError: false,
    });

    render(<JustLaunchedCarousel />);

    expect(screen.queryByText('Image Missing Phone')).toBeNull();
    expect(screen.getByText('Xiaomi 17T')).toBeTruthy();
  });

  it('skips placeholder-only rows even though their image is truthy', () => {
    // transformProduct falls back to PRODUCT_PLACEHOLDER_IMAGE when a product has
    // no uploaded images, so `image` is truthy. Such a "No Image" row must not be
    // hoisted into a launch slot just because it is newer/pinned.
    mockUsePinned.mockReturnValue({
      data: [
        {
          id: 'placeholder-pin',
          name: 'Placeholder Only Phone',
          slug: 'placeholder-only-phone',
          price: 500000,
          image: PRODUCT_PLACEHOLDER_IMAGE,
          images: [],
        },
      ],
    });
    mockUseProducts.mockReturnValue({
      products: [xiaomi],
      isLoading: false,
      isError: false,
    });

    render(<JustLaunchedCarousel />);

    expect(screen.queryByText('Placeholder Only Phone')).toBeNull();
    expect(screen.getByText('Xiaomi 17T')).toBeTruthy();
  });

  it('renders a loading skeleton (not a blank gap) while loading', () => {
    mockUseProducts.mockReturnValue({
      products: [],
      isLoading: true,
      isError: false,
    });

    render(<JustLaunchedCarousel />);

    expect(screen.getByText('Just Launched')).toBeTruthy();
    expect(screen.getAllByRole('progressbar').length).toBeGreaterThan(0);
  });

  it('keeps the skeleton while the pinned fetch is still loading (no pop-in)', () => {
    // The recent feed has resolved, but the pinned-slug query has not — without
    // gating on both, pinned slides would pop in after the skeleton dismissed.
    mockUseProducts.mockReturnValue({
      products: [xiaomi],
      isLoading: false,
      isError: false,
    });
    mockUsePinned.mockReturnValue({ data: undefined, isLoading: true });

    render(<JustLaunchedCarousel />);

    expect(screen.getAllByRole('progressbar').length).toBeGreaterThan(0);
    expect(screen.queryByText('Xiaomi 17T')).toBeNull();
  });

  it('renders nothing on error', () => {
    mockUseProducts.mockReturnValue({
      products: [],
      isLoading: false,
      isError: true,
    });

    const { toJSON } = render(<JustLaunchedCarousel />);
    expect(toJSON()).toBeNull();
  });

  it('renders nothing when there are no launch products', () => {
    mockUseProducts.mockReturnValue({
      products: [],
      isLoading: false,
      isError: false,
    });
    mockUsePinned.mockReturnValue({ data: [] });

    const { toJSON } = render(<JustLaunchedCarousel />);
    expect(toJSON()).toBeNull();
  });
});
