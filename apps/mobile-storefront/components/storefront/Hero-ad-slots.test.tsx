import { describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as placements from '@/config/mobile-ad-placements';
import { getTemplateConfig } from '@/lib/templates';
import {
  baseTemplate,
  mockExpoImageModule,
  mockThemeModule,
  mockUseMobileAdsReadiness,
  slide,
} from './Hero-test-harness';

jest.mock('@/hooks/use-mobile-ads-readiness', () => ({
  useMobileAdsReadiness: mockUseMobileAdsReadiness,
}));
jest.mock('react-native-google-mobile-ads', () => ({
  BannerAd: 'BannerAd',
  BannerAdSize: {
    LARGE_ANCHORED_ADAPTIVE_BANNER: 'large-anchored-adaptive-banner',
  },
}));
jest.mock('@/services/analytics-core', () => ({
  trackEvent: jest.fn(),
}));
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ fontScale: 1, height: 800, scale: 2, width: 400 }),
}));
jest.mock('expo-image', () => mockExpoImageModule());
jest.mock('expo-linear-gradient', () => {
  const { View } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return { LinearGradient: View };
});
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useIsFocused: () => true,
}));
jest.mock('@/hooks/useTheme', () => mockThemeModule());
jest.mock('@/lib/config', () => ({
  CONFIG: { BUSINESS_TYPE: 'electronics', TEMPLATE_ID: 'test' },
}));
jest.mock('@/lib/templates', () => ({
  getTemplateConfig: jest.fn(),
}));

const mockedGetTemplateConfig = getTemplateConfig as jest.MockedFunction<
  typeof getTemplateConfig
>;

import { Hero } from './Hero';

describe('Hero trailing ad slide', () => {
  const ORIGINAL_FLAG = process.env.EXPO_PUBLIC_MOBILE_ADS_ENABLED;

  function renderCarousel(
    extraProps: { trailingAdPlacement?: 'HOME_STRIP' } = {}
  ) {
    mockedGetTemplateConfig.mockReset();
    mockedGetTemplateConfig.mockReturnValue({
      ...baseTemplate,
      heroVariant: 'carousel',
    });
    return render(<Hero slides={[slide]} {...extraProps} />);
  }

  it('appends a sponsored slide after the CMS slides when enabled', () => {
    process.env.EXPO_PUBLIC_MOBILE_ADS_ENABLED = 'true';
    renderCarousel({ trailingAdPlacement: 'HOME_STRIP' });

    expect(screen.getByTestId('hero-ad-slide')).toBeTruthy();
    process.env.EXPO_PUBLIC_MOBILE_ADS_ENABLED = ORIGINAL_FLAG;
  });

  it('withholds the native banner until the ad slide is viewable', () => {
    // Regression: the list eagerly renders its initial batch, so the
    // second slide's banner must not request while offscreen.
    process.env.EXPO_PUBLIC_MOBILE_ADS_ENABLED = 'true';
    renderCarousel({ trailingAdPlacement: 'HOME_STRIP' });
    const list = screen.getByTestId('hero-carousel-list');

    expect(screen.UNSAFE_queryByType('BannerAd' as never)).toBeNull();
    act(() => {
      fireEvent(list, 'onViewableItemsChanged', {
        changed: [],
        viewableItems: [{ index: 1, isViewable: true, item: { kind: 'x' } }],
      });
    });
    expect(screen.UNSAFE_queryByType('BannerAd' as never)).toBeNull();
    act(() => {
      fireEvent(list, 'onViewableItemsChanged', {
        changed: [],
        viewableItems: [
          { index: 1, isViewable: true, item: { kind: 'hero-ad-slide' } },
        ],
      });
    });
    expect(screen.UNSAFE_getByType('BannerAd' as never)).toBeTruthy();
    act(() => {
      fireEvent(list, 'onViewableItemsChanged', {
        changed: [],
        viewableItems: [],
      });
    });
    expect(screen.UNSAFE_queryByType('BannerAd' as never)).toBeNull();
    process.env.EXPO_PUBLIC_MOBILE_ADS_ENABLED = ORIGINAL_FLAG;
  });

  it('renders no ad slide without a placement', () => {
    process.env.EXPO_PUBLIC_MOBILE_ADS_ENABLED = 'true';
    renderCarousel();

    expect(screen.queryByTestId('hero-ad-slide')).toBeNull();
    process.env.EXPO_PUBLIC_MOBILE_ADS_ENABLED = ORIGINAL_FLAG;
  });

  it('renders no ad slide while ads are disabled', () => {
    delete process.env.EXPO_PUBLIC_MOBILE_ADS_ENABLED;
    renderCarousel({ trailingAdPlacement: 'HOME_STRIP' });

    expect(screen.queryByTestId('hero-ad-slide')).toBeNull();
    process.env.EXPO_PUBLIC_MOBILE_ADS_ENABLED = ORIGINAL_FLAG;
  });

  it('fails closed when the placement is misconfigured instead of crashing', () => {
    // Regression: getMobileAdUnitId throws for unconfigured production IDs;
    // the hero must omit the ad slide rather than take down the home feed.
    process.env.EXPO_PUBLIC_MOBILE_ADS_ENABLED = 'true';
    const spy = jest
      .spyOn(placements, 'getMobileAdUnitId')
      .mockImplementation(() => {
        throw new Error('[mobile-ads] misconfigured');
      });
    renderCarousel({ trailingAdPlacement: 'HOME_STRIP' });

    expect(screen.queryByTestId('hero-ad-slide')).toBeNull();
    expect(screen.getAllByTestId('hero-image')).toHaveLength(1);
    spy.mockRestore();
    process.env.EXPO_PUBLIC_MOBILE_ADS_ENABLED = ORIGINAL_FLAG;
  });

  it('withholds the ad slide until consent is ready', () => {
    process.env.EXPO_PUBLIC_MOBILE_ADS_ENABLED = 'true';
    mockUseMobileAdsReadiness.mockReturnValueOnce({
      canRequestAds: false,
      initialized: false,
    });
    renderCarousel({ trailingAdPlacement: 'HOME_STRIP' });

    expect(screen.queryByTestId('hero-ad-slide')).toBeNull();
    expect(screen.getAllByTestId('hero-image')).toHaveLength(1);
    process.env.EXPO_PUBLIC_MOBILE_ADS_ENABLED = ORIGINAL_FLAG;
  });

  it('drops the ad slide when the banner fails to load instead of keeping a blank page', () => {
    // Regression: on no-fill or load error the carousel must remove the
    // sponsored slide so autoplay never rotates onto a blank hero page.
    process.env.EXPO_PUBLIC_MOBILE_ADS_ENABLED = 'true';
    renderCarousel({ trailingAdPlacement: 'HOME_STRIP' });
    act(() => {
      fireEvent(
        screen.getByTestId('hero-carousel-list'),
        'onViewableItemsChanged',
        {
          changed: [],
          viewableItems: [
            { index: 1, isViewable: true, item: { kind: 'hero-ad-slide' } },
          ],
        }
      );
    });

    expect(screen.getByTestId('hero-ad-slide')).toBeTruthy();
    const banner = screen.UNSAFE_getByType('BannerAd' as never);
    act(() => {
      (banner.props as { onAdFailedToLoad: () => void }).onAdFailedToLoad();
    });

    expect(screen.queryByTestId('hero-ad-slide')).toBeNull();
    expect(screen.getAllByTestId('hero-image')).toHaveLength(1);
    process.env.EXPO_PUBLIC_MOBILE_ADS_ENABLED = ORIGINAL_FLAG;
  });
});
