import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { getTemplateConfig } from '@/lib/templates';
import {
  baseTemplate,
  mockExpoImageModule,
  mockThemeModule,
  mockUseMobileAdsReadiness,
  slide,
} from './Hero-test-harness';

let mockFocused = true;
let mockAppStateListeners: Array<(state: AppStateStatus) => void> = [];
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useIsFocused: () => mockFocused,
}));
jest.mock('@/hooks/use-mobile-ads-readiness', () => ({
  useMobileAdsReadiness: mockUseMobileAdsReadiness,
}));
jest.mock('react-native-google-mobile-ads', () => ({
  BannerAd: 'BannerAd',
  BannerAdSize: { LARGE_ANCHORED_ADAPTIVE_BANNER: 'large' },
}));
jest.mock('@/services/analytics-core', () => ({ trackEvent: jest.fn() }));
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
jest.mock('@/hooks/useTheme', () => mockThemeModule());
jest.mock('@/lib/config', () => ({
  CONFIG: { BUSINESS_TYPE: 'electronics', TEMPLATE_ID: 'test' },
}));
jest.mock('@/lib/templates', () => ({ getTemplateConfig: jest.fn() }));

import { Hero } from './Hero';

const slides = [
  slide,
  { ...slide, title: 'Second', image: 'https://example.com/second.png' },
];

describe('hero autoplay visibility', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockFocused = true;
    mockAppStateListeners = [];
    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      value: 'active',
    });
    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_type, listener) => {
        mockAppStateListeners.push(listener as (state: AppStateStatus) => void);
        return { remove: jest.fn() };
      });
    jest
      .mocked(getTemplateConfig)
      .mockReturnValue({ ...baseTemplate, heroVariant: 'standard' });
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });
  it('does not schedule autoplay while search obscures the hero, and resumes once', () => {
    const timer = jest.spyOn(global, 'setInterval');
    const view = render(<Hero slides={slides} autoplayPaused />);
    expect(timer).not.toHaveBeenCalled();
    view.rerender(<Hero slides={slides} autoplayPaused={false} />);
    expect(timer).toHaveBeenCalledTimes(1);
    view.rerender(<Hero slides={slides} autoplayPaused />);
    act(() => jest.advanceTimersByTime(10000));
    expect(jest.getTimerCount()).toBe(0);
  });
  it('preserves manual selection while paused and resumes from that slide', () => {
    const timer = jest.spyOn(global, 'setInterval');
    const view = render(<Hero slides={slides} autoplayPaused />);
    fireEvent(screen.getByTestId('hero-carousel-list'), 'onMomentumScrollEnd', {
      nativeEvent: { contentOffset: { x: 400 } },
    });
    const dots = screen.getByTestId('hero-dots');
    expect(dots.children[1]).toEqual(
      expect.objectContaining({
        props: expect.objectContaining({ testID: 'hero-dot-active' }),
      })
    );
    expect(timer).not.toHaveBeenCalled();
    view.rerender(<Hero slides={slides} autoplayPaused={false} />);
    expect(timer).toHaveBeenCalledTimes(1);
  });

  it('does not schedule while another route is focused and restarts once on return', () => {
    const timer = jest.spyOn(global, 'setInterval');
    mockFocused = false;
    const view = render(<Hero slides={slides} />);
    expect(timer).not.toHaveBeenCalled();
    mockFocused = true;
    view.rerender(<Hero slides={slides} />);
    expect(timer).toHaveBeenCalledTimes(1);
  });
  it('clears autoplay in background and restarts once in foreground', () => {
    const timer = jest.spyOn(global, 'setInterval');
    const clear = jest.spyOn(global, 'clearInterval');
    render(<Hero slides={slides} />);
    expect(timer).toHaveBeenCalledTimes(1);
    act(() => {
      mockAppStateListeners.forEach((listener) => {
        listener('background');
      });
    });
    expect(clear).toHaveBeenCalledTimes(1);
    act(() => {
      mockAppStateListeners.forEach((listener) => {
        listener('active');
      });
    });
    expect(timer).toHaveBeenCalledTimes(2);
  });
});
