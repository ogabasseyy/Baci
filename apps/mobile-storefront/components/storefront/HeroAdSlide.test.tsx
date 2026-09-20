import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { HeroAdSlide } from './HeroAdSlide';

jest.mock('react-native-google-mobile-ads', () => ({
  BannerAd: 'BannerAd',
  BannerAdSize: {
    LARGE_ANCHORED_ADAPTIVE_BANNER: 'large-anchored-adaptive-banner',
  },
}));
jest.mock('@/services/analytics-core', () => ({
  trackEvent: jest.fn(),
}));

let mockDrawerOpen = false;
jest.mock('@/stores/drawer-store', () => ({
  useDrawerStore: (selector: (state: { isOpen: boolean }) => boolean) =>
    selector({ isOpen: mockDrawerOpen }),
}));

let mockIsFocused = true;
jest.mock('expo-router', () => ({
  useIsFocused: () => mockIsFocused,
}));

const props = {
  height: 120,
  isVisible: true,
  placement: 'HOME_STRIP' as const,
  screenWidth: 390,
  unitId: 'test-hero-unit',
};

describe('HeroAdSlide', () => {
  it('renders the home banner while the drawer is closed', () => {
    // Arrange & Act
    mockDrawerOpen = false;
    render(<HeroAdSlide {...props} />);

    // Assert
    expect(screen.getByTestId('hero-ad-slide')).toBeTruthy();
    expect(screen.UNSAFE_getByType('BannerAd' as never)).toBeTruthy();
  });

  it('withholds the banner while the slide is offscreen', () => {
    // Regression: the list eagerly renders its initial batch, so an
    // offscreen slide must not construct its native banner. The same-size
    // placeholder keeps paging layout stable.
    // Arrange & Act
    mockDrawerOpen = false;
    render(<HeroAdSlide {...props} isVisible={false} />);

    // Assert
    expect(screen.getByTestId('hero-ad-slide')).toBeTruthy();
    expect(screen.UNSAFE_queryByType('BannerAd' as never)).toBeNull();
  });

  it('keeps the fixed-size placeholder while the drawer is open', () => {
    // Regression: the carousel still carries the ad slide and page offset,
    // so suspension must withhold the banner without collapsing the child
    // (which would jump the visible hero when the drawer closes).
    // Arrange & Act
    mockDrawerOpen = true;
    try {
      render(<HeroAdSlide {...props} />);

      // Assert
      expect(screen.getByTestId('hero-ad-slide')).toBeTruthy();
      expect(screen.UNSAFE_queryByType('BannerAd' as never)).toBeNull();
    } finally {
      mockDrawerOpen = false;
    }
  });

  it('keeps the fixed-size placeholder when the route is not focused', () => {
    // Regression: a pushed route keeps this screen mounted, so an
    // unfocused route withholds the banner but must not collapse the
    // slide the carousel still accounts for.
    // Arrange & Act
    mockIsFocused = false;
    try {
      render(<HeroAdSlide {...props} />);

      // Assert
      expect(screen.getByTestId('hero-ad-slide')).toBeTruthy();
      expect(screen.UNSAFE_queryByType('BannerAd' as never)).toBeNull();
    } finally {
      mockIsFocused = true;
    }
  });
});
