import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, render, screen } from '@testing-library/react-native';
import {
  a27,
  hideAdCard,
  mockExpoImageModule,
  mockPush,
  mockReactNativeModule,
  mockSkeletonModule,
  mockThemeModule,
  mockUseMobileAdsReadiness,
  mockUsePinned,
  mockUseProducts,
  setupCarouselMocks,
  showAdCard,
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

import { JustLaunchedCarousel } from './JustLaunchedCarousel';

describe('JustLaunchedCarousel ad slots', () => {
  beforeEach(() => {
    setupCarouselMocks();
  });

  it('inserts the sponsored card second when ads are enabled', () => {
    process.env.EXPO_PUBLIC_MOBILE_ADS_ENABLED = 'true';
    mockUseProducts.mockReturnValue({
      products: [xiaomi, a27],
      isLoading: false,
      isError: false,
    });

    render(<JustLaunchedCarousel adPlacement="PRODUCT_GRID_MPU" />);

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

    render(<JustLaunchedCarousel adPlacement="PRODUCT_GRID_MPU" />);
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

    render(<JustLaunchedCarousel adPlacement="PRODUCT_GRID_MPU" />);

    expect(screen.getByTestId('launch-ad-card')).toBeTruthy();
    expect(screen.UNSAFE_queryByType('BannerAd' as never)).toBeNull();
    showAdCard();
    expect(screen.UNSAFE_getByType('BannerAd' as never)).toBeTruthy();
    hideAdCard();
    expect(screen.UNSAFE_queryByType('BannerAd' as never)).toBeNull();
    delete process.env.EXPO_PUBLIC_MOBILE_ADS_ENABLED;
  });

  it('renders no sponsored card without an explicit placement even when ads are enabled', () => {
    // Regression: an undefined placement must stay disabled — a default
    // that converts it back to PRODUCT_GRID_MPU lets repeated blocks own
    // one logical slot despite the page-level owner election.
    process.env.EXPO_PUBLIC_MOBILE_ADS_ENABLED = 'true';
    mockUseProducts.mockReturnValue({
      products: [xiaomi, a27],
      isLoading: false,
      isError: false,
    });

    render(<JustLaunchedCarousel />);

    expect(screen.queryByTestId('launch-ad-card')).toBeNull();
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
});
