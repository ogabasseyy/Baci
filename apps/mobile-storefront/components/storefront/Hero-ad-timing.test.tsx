import { describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { FlatList } from 'react-native';
import { getTemplateConfig } from '@/lib/templates';
import type { HeroSlide } from './Hero';
import {
  baseTemplate,
  mockExpoImageModule,
  mockThemeModule,
  mockUseMobileAdsReadiness,
  renderedMarkerOrder,
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

describe('Hero ad slide timing', () => {
  const ORIGINAL_FLAG = process.env.EXPO_PUBLIC_MOBILE_ADS_ENABLED;

  it('keeps the visible hero in place when the ad slide inserts late', () => {
    // Regression: consent resolving after the carousel advanced must not
    // replace the shopper's current hero with the inserted ad slide — the
    // offset shifts by one page and the active dot follows the same slide.
    process.env.EXPO_PUBLIC_MOBILE_ADS_ENABLED = 'true';
    mockedGetTemplateConfig.mockReset();
    mockedGetTemplateConfig.mockReturnValue({
      ...baseTemplate,
      heroVariant: 'carousel',
    });
    const secondSlide: HeroSlide = { ...slide, title: 'Second slide' };
    mockUseMobileAdsReadiness.mockReturnValueOnce({
      canRequestAds: false,
      initialized: false,
    });
    const { rerender } = render(
      <Hero slides={[slide, secondSlide]} trailingAdPlacement="HOME_STRIP" />
    );
    expect(screen.queryByTestId('hero-ad-slide')).toBeNull();
    act(() => {
      // A settled fling always emits scroll events before momentum end. Drive
      // the outer FlatList composite: the testID target is the inner list
      // whose onScroll is VirtualizedList internals needing layout metrics.
      screen
        .UNSAFE_getByType(FlatList)
        .props.onScroll({ nativeEvent: { contentOffset: { x: 400 } } });
      fireEvent(
        screen.getByTestId('hero-carousel-list'),
        'onMomentumScrollEnd',
        {
          nativeEvent: { contentOffset: { x: 400 } },
        }
      );
    });

    // The one-shot denial is consumed by the first render; the default
    // mock grants consent from here on.
    rerender(
      <Hero slides={[slide, secondSlide]} trailingAdPlacement="HOME_STRIP" />
    );

    expect(screen.getByTestId('hero-ad-slide')).toBeTruthy();
    const dots = screen.getByTestId('hero-dots');
    const dotIds = dots.children.map((child) =>
      typeof child === 'string' ? child : child.props.testID
    );
    expect(dotIds).toEqual(['hero-dot', 'hero-dot', 'hero-dot-active']);
    process.env.EXPO_PUBLIC_MOBILE_ADS_ENABLED = ORIGINAL_FLAG;
  });

  it('compensates from the live offset when the ad slide inserts mid-drag', () => {
    // Regression: a toggle landing while the shopper drags must compensate
    // from the list's actual offset, not the last snapped page — otherwise
    // the carousel jumps to the preceding page.
    process.env.EXPO_PUBLIC_MOBILE_ADS_ENABLED = 'true';
    mockedGetTemplateConfig.mockReset();
    mockedGetTemplateConfig.mockReturnValue({
      ...baseTemplate,
      heroVariant: 'carousel',
    });
    const secondSlide: HeroSlide = { ...slide, title: 'Second slide' };
    const thirdSlide: HeroSlide = { ...slide, title: 'Third slide' };
    mockUseMobileAdsReadiness.mockReturnValueOnce({
      canRequestAds: false,
      initialized: false,
    });
    const { rerender } = render(
      <Hero
        slides={[slide, secondSlide, thirdSlide]}
        trailingAdPlacement="HOME_STRIP"
      />
    );
    expect(screen.queryByTestId('hero-ad-slide')).toBeNull();
    const scroller = screen.UNSAFE_getByType(FlatList);
    const list = screen.getByTestId('hero-carousel-list');
    act(() => {
      // Drive the outer composite (see above): the testID target's onScroll
      // is VirtualizedList internals needing full layout metrics.
      scroller.props.onScroll({ nativeEvent: { contentOffset: { x: 400 } } });
      fireEvent(list, 'onMomentumScrollEnd', {
        nativeEvent: { contentOffset: { x: 400 } },
      });
      // Mid-drag toward the third slide: no momentum end follows.
      scroller.props.onScroll({ nativeEvent: { contentOffset: { x: 640 } } });
    });

    rerender(
      <Hero
        slides={[slide, secondSlide, thirdSlide]}
        trailingAdPlacement="HOME_STRIP"
      />
    );

    expect(screen.getByTestId('hero-ad-slide')).toBeTruthy();
    const dots = screen.getByTestId('hero-dots');
    const dotIds = dots.children.map((child) =>
      typeof child === 'string' ? child : child.props.testID
    );
    expect(dotIds).toEqual([
      'hero-dot',
      'hero-dot',
      'hero-dot',
      'hero-dot-active',
    ]);
    process.env.EXPO_PUBLIC_MOBILE_ADS_ENABLED = ORIGINAL_FLAG;
  });

  it('places the ad slide second, not last', () => {
    process.env.EXPO_PUBLIC_MOBILE_ADS_ENABLED = 'true';
    mockedGetTemplateConfig.mockReset();
    mockedGetTemplateConfig.mockReturnValue({
      ...baseTemplate,
      heroVariant: 'carousel',
    });
    const secondSlide: HeroSlide = { ...slide, title: 'Second slide' };
    render(
      <Hero slides={[slide, secondSlide]} trailingAdPlacement="HOME_STRIP" />
    );

    const markers = renderedMarkerOrder();
    const adIndex = markers.indexOf('hero-ad-slide');
    const imageIndexes = markers.reduce<number[]>((acc, marker, index) => {
      if (marker === 'hero-image') acc.push(index);
      return acc;
    }, []);
    expect(imageIndexes).toHaveLength(2);
    expect(adIndex).toBeGreaterThan(imageIndexes[0]);
    expect(adIndex).toBeLessThan(imageIndexes[1]);
    process.env.EXPO_PUBLIC_MOBILE_ADS_ENABLED = ORIGINAL_FLAG;
  });
});
