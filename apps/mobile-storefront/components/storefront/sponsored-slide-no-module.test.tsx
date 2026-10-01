import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { HeroAdSlide } from './HeroAdSlide';
import { LaunchAdCard } from './LaunchAdCard';

jest.mock('react-native-google-mobile-ads', () => {
  throw new Error('no native module');
});
jest.mock('@/services/analytics-core', () => ({
  trackEvent: jest.fn(),
}));
jest.mock('@/stores/drawer-store', () => ({
  useDrawerStore: () => false,
}));
jest.mock('expo-router', () => ({
  useIsFocused: () => true,
}));

describe('sponsored slides without a native ads module', () => {
  it('reports a load failure so the carousels drop the blank slide', () => {
    // Regression: in builds without the native module (e.g. Expo Go) the
    // parent still inserts the sponsored slide — silently rendering null
    // would leave autoplay rotating onto a blank page it can never fill.
    const onHeroFailed = jest.fn();
    const onLaunchFailed = jest.fn();

    render(
      <HeroAdSlide
        height={120}
        isVisible
        onAdFailedToLoad={onHeroFailed}
        placement="HOME_STRIP"
        screenWidth={390}
        unitId="test-hero-unit"
      />
    );
    render(
      <LaunchAdCard
        cardWidth={168}
        colors={{ border: '#e5e5e5', card: '#ffffff', textSecondary: '#666' }}
        isVisible
        onAdFailedToLoad={onLaunchFailed}
        placement="PRODUCT_GRID_MPU"
        unitId="test-launch-unit"
      />
    );

    expect(onHeroFailed).toHaveBeenCalledTimes(1);
    expect(onLaunchFailed).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('hero-ad-slide')).toBeNull();
    expect(screen.queryByTestId('launch-ad-card')).toBeNull();
  });
});
