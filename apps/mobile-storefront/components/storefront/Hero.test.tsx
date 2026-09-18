import { jest } from '@jest/globals';
import { act, render, screen } from '@testing-library/react-native';
import * as placements from '@/config/mobile-ad-placements';
import { useMobileAdsReadiness } from '@/hooks/use-mobile-ads-readiness';
import { getTemplateConfig } from '@/lib/templates';
import type { HeroSlide } from './Hero';
import { Hero } from './Hero';

jest.mock('@/hooks/use-mobile-ads-readiness', () => ({
  useMobileAdsReadiness: jest.fn(() => ({
    canRequestAds: true,
    initialized: true,
  })),
}));

const mockUseMobileAdsReadiness = jest.mocked(useMobileAdsReadiness);

function renderedMarkerOrder(): string[] {
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
  return markers;
}

jest.mock('react-native-google-mobile-ads', () => ({
  BannerAd: 'BannerAd',
  BannerAdSize: {
    LARGE_ANCHORED_ADAPTIVE_BANNER: 'large-anchored-adaptive-banner',
  },
}));
jest.mock('@/services/analytics-core', () => ({
  trackEvent: jest.fn(),
}));

const mockImage = jest.fn();

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ fontScale: 1, height: 800, scale: 2, width: 400 }),
}));

jest.mock('expo-image', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { View } =
    jest.requireActual<typeof import('react-native')>('react-native');

  return {
    Image: (props: Record<string, unknown>) => {
      mockImage(props);
      return React.createElement(View, { ...props, testID: 'hero-image' });
    },
  };
});

jest.mock('expo-linear-gradient', () => {
  const { View } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return { LinearGradient: View };
});

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
}));

jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      background: '#ffffff',
      border: '#dddddd',
      card: '#ffffff',
      muted: '#f2f2f2',
      text: '#111111',
      textSecondary: '#666666',
    },
    isDark: false,
  }),
}));

jest.mock('@/lib/config', () => ({
  CONFIG: { BUSINESS_TYPE: 'electronics', TEMPLATE_ID: 'test' },
}));

jest.mock('@/lib/templates', () => ({
  getTemplateConfig: jest.fn(),
}));

const mockedGetTemplateConfig = getTemplateConfig as jest.MockedFunction<
  typeof getTemplateConfig
>;

const slide: HeroSlide = {
  ctaLink: '/category/phones',
  ctaText: 'Shop now',
  image: 'https://cdn.ogabassey.com/core-assets/products/hero.avif',
  subtitle: 'Available now',
  title: 'Featured phones',
};

const baseTemplate = {
  borderRadius: 'md' as const,
  cardVariant: 'grid' as const,
  categoryStyle: 'pill' as const,
  features: {},
  headerStyle: 'standard' as const,
  spacing: 'compact' as const,
};

function renderHero(heroVariant: 'parallax' | 'carousel' | 'standard') {
  mockedGetTemplateConfig.mockReturnValue({
    ...baseTemplate,
    heroVariant,
  });
  return render(<Hero slides={[slide]} />);
}

describe('Hero bounded image sources', () => {
  beforeEach(() => {
    mockImage.mockClear();
    mockedGetTemplateConfig.mockReset();
  });

  it('uses a bounded contain source for the elite hero image', () => {
    renderHero('parallax');

    expect(mockImage).toHaveBeenCalledWith(
      expect.objectContaining({
        source: {
          height: 440,
          uri: 'https://cdn.ogabassey.com/image/width=400,height=440,quality=82,format=webp/core-assets/products/hero.avif',
          width: 400,
        },
      })
    );
  });

  it('uses a bounded cover source for the fashion hero image', () => {
    renderHero('carousel');

    expect(mockImage).toHaveBeenCalledWith(
      expect.objectContaining({
        source: {
          height: 900,
          uri: 'https://cdn.ogabassey.com/image/width=800,height=900,quality=82,format=webp,fit=cover/core-assets/products/hero.avif',
          width: 800,
        },
      })
    );
  });

  it('uses a bounded cover source for the standard hero image', () => {
    renderHero('standard');

    expect(mockImage).toHaveBeenCalledWith(
      expect.objectContaining({
        source: {
          height: 440,
          uri: 'https://cdn.ogabassey.com/image/width=800,height=440,quality=82,format=webp,fit=cover/core-assets/products/hero.avif',
          width: 800,
        },
      })
    );
  });
});

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

    expect(screen.getByTestId('hero-ad-slide')).toBeTruthy();
    const banner = screen.UNSAFE_getByType('BannerAd' as never);
    act(() => {
      (banner.props as { onAdFailedToLoad: () => void }).onAdFailedToLoad();
    });

    expect(screen.queryByTestId('hero-ad-slide')).toBeNull();
    expect(screen.getAllByTestId('hero-image')).toHaveLength(1);
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
