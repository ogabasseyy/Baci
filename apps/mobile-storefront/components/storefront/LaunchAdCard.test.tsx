import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { LaunchAdCard } from './LaunchAdCard';

jest.mock('react-native-google-mobile-ads', () => ({
  BannerAd: 'BannerAd',
  BannerAdSize: {
    INLINE_ADAPTIVE_BANNER: 'inline-adaptive-banner',
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
  cardWidth: 168,
  colors: {
    border: '#e5e5e5',
    card: '#ffffff',
    textSecondary: '#666666',
  },
  isVisible: true,
  placement: 'PRODUCT_GRID_MPU' as const,
  unitId: 'test-launch-unit',
};

describe('LaunchAdCard', () => {
  it('renders the carousel ad while the drawer is closed', () => {
    // Arrange & Act
    mockDrawerOpen = false;
    render(<LaunchAdCard {...props} />);

    // Assert
    expect(screen.getByTestId('launch-ad-card')).toBeTruthy();
    expect(screen.UNSAFE_getByType('BannerAd' as never)).toBeTruthy();
  });

  it('sizes the banner to the card width instead of the full screen', () => {
    // Regression: an anchored creative resolves for the full screen width
    // and clips horizontally under the card width, padding, and overflow.
    // Arrange & Act
    render(<LaunchAdCard {...props} />);

    // Assert
    const banner = screen.UNSAFE_getByType('BannerAd' as never) as {
      props: { size?: unknown };
    };
    expect(banner.props.size).toBe('inline-adaptive-banner');
  });

  it('withholds the banner while the card is offscreen', () => {
    // Regression: the list eagerly renders its initial batch, so an
    // offscreen card must not construct its native banner. The same-size
    // placeholder keeps list layout stable.
    // Arrange & Act
    mockDrawerOpen = false;
    render(<LaunchAdCard {...props} isVisible={false} />);

    // Assert
    expect(screen.getByTestId('launch-ad-card')).toBeTruthy();
    expect(screen.UNSAFE_queryByType('BannerAd' as never)).toBeNull();
  });

  it('keeps the fixed-size placeholder while the drawer is open', () => {
    // Regression: the carousel still carries the ad sentinel and offset,
    // so suspension must withhold the banner without collapsing the child
    // (which would jump the visible product when the drawer closes).
    // Arrange & Act
    mockDrawerOpen = true;
    try {
      render(<LaunchAdCard {...props} />);

      // Assert
      expect(screen.getByTestId('launch-ad-card')).toBeTruthy();
      expect(screen.UNSAFE_queryByType('BannerAd' as never)).toBeNull();
    } finally {
      mockDrawerOpen = false;
    }
  });

  it('keeps the fixed-size placeholder when the route is not focused', () => {
    // Regression: a pushed route keeps this screen mounted, so an
    // unfocused route withholds the banner but must not collapse the
    // card the scrolled carousel still accounts for.
    // Arrange & Act
    mockIsFocused = false;
    try {
      render(<LaunchAdCard {...props} />);

      // Assert
      expect(screen.getByTestId('launch-ad-card')).toBeTruthy();
      expect(screen.UNSAFE_queryByType('BannerAd' as never)).toBeNull();
    } finally {
      mockIsFocused = true;
    }
  });
});
