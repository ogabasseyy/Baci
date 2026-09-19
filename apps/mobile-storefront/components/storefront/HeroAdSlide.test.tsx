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

  it('suspends the home banner while the drawer is open', () => {
    // Regression: the feed stays mounted behind the drawer backdrop, so
    // an obscured banner must not load or refresh there.
    // Arrange & Act
    mockDrawerOpen = true;
    try {
      const { toJSON } = render(<HeroAdSlide {...props} />);

      // Assert
      expect(toJSON()).toBeNull();
    } finally {
      mockDrawerOpen = false;
    }
  });

  it('unmounts the banner when the route is not focused', () => {
    // Regression: a pushed route keeps this screen mounted, so an
    // unfocused route must not own or refresh the banner behind it.
    // Arrange & Act
    mockIsFocused = false;
    try {
      const { toJSON } = render(<HeroAdSlide {...props} />);

      // Assert
      expect(toJSON()).toBeNull();
    } finally {
      mockIsFocused = true;
    }
  });
});
