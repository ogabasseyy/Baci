import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useMobileAdsReadiness } from '@/hooks/use-mobile-ads-readiness';

jest.mock('@/hooks/use-mobile-ads-readiness', () => ({
  useMobileAdsReadiness: jest.fn(() => ({
    canRequestAds: true,
    initialized: true,
  })),
}));

const mockUseMobileAdsReadiness = jest.mocked(useMobileAdsReadiness);

jest.mock('@/services/analytics-core', () => ({
  trackEvent: jest.fn(),
}));

jest.mock('react-native-google-mobile-ads', () => ({
  BannerAd: 'BannerAd',
  BannerAdSize: {
    ANCHORED_ADAPTIVE_BANNER: 'anchored-adaptive-banner',
  },
}));

const mockPush = jest.fn();
const mockUseProducts = jest.fn();
const mockUsePinned = jest.fn();
const mockImage = jest.fn();
const mockCaptureViewability = jest.fn();
jest.mock('expo-image', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return {
    Image: (props: Record<string, unknown>) => {
      mockImage(props);
      return React.createElement('Image', props);
    },
  };
});
jest.mock('react-native', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const actual =
    jest.requireActual<typeof import('react-native')>('react-native');
  const mocked = Object.defineProperties(
    {},
    Object.getOwnPropertyDescriptors(actual)
  );
  Object.defineProperties(mocked, {
    FlatList: {
      configurable: true,
      value: ({
        data,
        keyExtractor,
        onViewableItemsChanged,
        renderItem,
      }: {
        data: unknown[];
        keyExtractor: (item: unknown, index: number) => string;
        onViewableItemsChanged?: (info: {
          viewableItems: Array<{ index?: number; isViewable?: boolean }>;
        }) => void;
        renderItem: (info: { item: unknown }) => React.ReactNode;
      }) => {
        mockCaptureViewability(onViewableItemsChanged);
        return React.createElement(
          React.Fragment,
          null,
          data.map((item, index) =>
            React.createElement(
              React.Fragment,
              { key: keyExtractor(item, index) },
              renderItem({ item })
            )
          )
        );
      },
    },
    PixelRatio: { configurable: true, value: { get: () => 2 } },
    Pressable: {
      configurable: true,
      value: ({
        children,
        ...props
      }: React.ComponentProps<typeof actual.View>) =>
        React.createElement(
          actual.View,
          { ...props, accessible: true },
          children
        ),
    },
    useWindowDimensions: {
      configurable: true,
      value: () => ({ fontScale: 1, height: 800, scale: 2, width: 400 }),
    },
  });
  return mocked;
});
jest.mock('expo-router', () => ({
  router: { push: (path: string) => mockPush(path) },
}));
jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      card: '#ffffff',
      background: '#ffffff',
      text: '#000000',
      textSecondary: '#666666',
      primary: '#d62027',
      border: '#cccccc',
    },
  }),
}));
jest.mock('@/hooks/use-products', () => ({
  useProducts: () => mockUseProducts(),
}));
jest.mock('@/hooks/use-pinned-launch-products', () => ({
  usePinnedLaunchProducts: () => mockUsePinned(),
}));
jest.mock('@/components/ui/Skeleton', () => {
  const { View } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Skeleton: () => <View accessibilityRole="progressbar" accessible />,
  };
});

import { PRODUCT_PLACEHOLDER_IMAGE } from '@/lib/product-normalization';
import { JustLaunchedCarousel } from './JustLaunchedCarousel';

const a27 = {
  id: 'a27',
  name: 'Samsung Galaxy A27 5G Preorder',
  slug: 'samsung-galaxy-a27-5g',
  price: 50000,
  image: 'https://cdn.ogabassey.com/core-assets/products/a27.avif',
};
const xiaomi = {
  id: 'xiaomi',
  name: 'Xiaomi 17T',
  slug: 'xiaomi-17t',
  price: 800000,
  image: 'https://cdn.ogabassey.com/core-assets/products/xiaomi.avif',
};

type ViewabilityInfo = {
  viewableItems: Array<{
    index?: number;
    isViewable?: boolean;
    item?: unknown;
  }>;
};

function latestViewabilityHandler():
  | ((info: ViewabilityInfo) => void)
  | undefined {
  const calls = mockCaptureViewability.mock.calls;
  return calls.at(-1)?.[0] as ((info: ViewabilityInfo) => void) | undefined;
}

function showAdCard(): void {
  act(() => {
    latestViewabilityHandler()?.({
      viewableItems: [
        { index: 1, isViewable: true, item: { kind: 'launch-ad-card' } },
      ],
    });
  });
}

function hideAdCard(): void {
  act(() => {
    latestViewabilityHandler()?.({ viewableItems: [] });
  });
}

describe('JustLaunchedCarousel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePinned.mockReturnValue({ data: [], isLoading: false });
    mockUseProducts.mockReturnValue({
      products: [],
      isLoading: false,
      isError: false,
    });
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

  it('inserts the sponsored card second when ads are enabled', () => {
    process.env.EXPO_PUBLIC_MOBILE_ADS_ENABLED = 'true';
    mockUseProducts.mockReturnValue({
      products: [xiaomi, a27],
      isLoading: false,
      isError: false,
    });

    render(<JustLaunchedCarousel />);

    const markers: string[] = [];
    const walk = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      const record = node as {
        children?: unknown;
        props?: { accessibilityLabel?: unknown; testID?: unknown };
      };
      const testID = record.props?.testID;
      const label = record.props?.accessibilityLabel;
      if (typeof testID === 'string') markers.push(testID);
      else if (typeof label === 'string') markers.push(label);
      if (record.children !== undefined) walk(record.children);
    };
    walk(screen.toJSON());

    const adIndex = markers.indexOf('launch-ad-card');
    const firstProductIndex = markers.findIndex((marker) =>
      marker.includes('Samsung Galaxy A27 5G Preorder')
    );
    const secondProductIndex = markers.findIndex((marker) =>
      marker.includes('Xiaomi 17T')
    );
    expect(adIndex).toBeGreaterThan(-1);
    expect(firstProductIndex).toBeGreaterThan(-1);
    expect(adIndex).toBeGreaterThan(firstProductIndex);
    expect(adIndex).toBeLessThan(secondProductIndex);
    delete process.env.EXPO_PUBLIC_MOBILE_ADS_ENABLED;
  });

  it('drops the sponsored card when the banner fails to load instead of keeping a blank slot', () => {
    // Regression: on no-fill or load error the carousel must remove the
    // sponsored card rather than retaining a blank 168px slot.
    process.env.EXPO_PUBLIC_MOBILE_ADS_ENABLED = 'true';
    mockUseProducts.mockReturnValue({
      products: [xiaomi, a27],
      isLoading: false,
      isError: false,
    });

    render(<JustLaunchedCarousel />);
    showAdCard();

    expect(screen.getByTestId('launch-ad-card')).toBeTruthy();
    const banner = screen.UNSAFE_getByType('BannerAd' as never);
    act(() => {
      (banner.props as { onAdFailedToLoad: () => void }).onAdFailedToLoad();
    });

    expect(screen.queryByTestId('launch-ad-card')).toBeNull();
    delete process.env.EXPO_PUBLIC_MOBILE_ADS_ENABLED;
  });

  it('withholds the native banner until the sponsored card is viewable', () => {
    // Regression: the list eagerly renders its initial batch, so the
    // sponsored card must not request while offscreen.
    process.env.EXPO_PUBLIC_MOBILE_ADS_ENABLED = 'true';
    mockUseProducts.mockReturnValue({
      products: [xiaomi, a27],
      isLoading: false,
      isError: false,
    });

    render(<JustLaunchedCarousel />);

    expect(screen.getByTestId('launch-ad-card')).toBeTruthy();
    expect(screen.UNSAFE_queryByType('BannerAd' as never)).toBeNull();
    showAdCard();
    expect(screen.UNSAFE_getByType('BannerAd' as never)).toBeTruthy();
    hideAdCard();
    expect(screen.UNSAFE_queryByType('BannerAd' as never)).toBeNull();
    delete process.env.EXPO_PUBLIC_MOBILE_ADS_ENABLED;
  });

  it('withholds the sponsored card while ads are suppressed', () => {
    // Regression: an obscured feed (e.g. search open) must not request or
    // attribute the sponsored card.
    process.env.EXPO_PUBLIC_MOBILE_ADS_ENABLED = 'true';
    mockUseProducts.mockReturnValue({
      products: [xiaomi, a27],
      isLoading: false,
      isError: false,
    });

    render(<JustLaunchedCarousel suppressAds />);

    expect(screen.queryByTestId('launch-ad-card')).toBeNull();
    delete process.env.EXPO_PUBLIC_MOBILE_ADS_ENABLED;
  });

  it('renders no sponsored card while ads are disabled', () => {
    delete process.env.EXPO_PUBLIC_MOBILE_ADS_ENABLED;
    mockUseProducts.mockReturnValue({
      products: [xiaomi, a27],
      isLoading: false,
      isError: false,
    });

    render(<JustLaunchedCarousel />);

    expect(screen.queryByTestId('launch-ad-card')).toBeNull();
  });

  it('withholds the sponsored card until consent is ready', () => {
    process.env.EXPO_PUBLIC_MOBILE_ADS_ENABLED = 'true';
    mockUseMobileAdsReadiness.mockReturnValueOnce({
      canRequestAds: false,
      initialized: false,
    });
    mockUseProducts.mockReturnValue({
      products: [xiaomi, a27],
      isLoading: false,
      isError: false,
    });

    render(<JustLaunchedCarousel />);

    expect(screen.queryByTestId('launch-ad-card')).toBeNull();
    delete process.env.EXPO_PUBLIC_MOBILE_ADS_ENABLED;
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
