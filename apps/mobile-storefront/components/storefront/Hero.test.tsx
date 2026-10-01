import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render } from '@testing-library/react-native';
import { getTemplateConfig } from '@/lib/templates';
import {
  baseTemplate,
  mockExpoImageModule,
  mockImage,
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

function renderHero(heroVariant: 'parallax' | 'carousel' | 'standard') {
  mockedGetTemplateConfig.mockReturnValue({
    ...baseTemplate,
    heroVariant,
  });
  return render(<Hero slides={[slide]} />);
}

import { Hero } from './Hero';

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
