import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { LaunchAdCard } from './LaunchAdCard';

jest.mock('react-native-google-mobile-ads', () => ({
  BannerAd: 'BannerAd',
  BannerAdSize: {
    ANCHORED_ADAPTIVE_BANNER: 'anchored-adaptive-banner',
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
  cardWidth: 168,
  colors: {
    border: '#e5e5e5',
    card: '#ffffff',
    textSecondary: '#666666',
  },
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
  });

  it('suspends the carousel ad while the drawer is open', () => {
    // Regression: the carousel stays mounted behind the drawer backdrop,
    // so an obscured card must not load or refresh there.
    // Arrange & Act
    mockDrawerOpen = true;
    try {
      const { toJSON } = render(<LaunchAdCard {...props} />);

      // Assert
      expect(toJSON()).toBeNull();
    } finally {
      mockDrawerOpen = false;
    }
  });
});
