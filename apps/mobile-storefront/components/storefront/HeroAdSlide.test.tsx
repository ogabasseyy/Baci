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

const props = {
  height: 120,
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
});
