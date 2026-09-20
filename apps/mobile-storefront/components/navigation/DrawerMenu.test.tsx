import { act, render, screen } from '@testing-library/react-native';
import { useMobileAdsReadiness } from '@/hooks/use-mobile-ads-readiness';
import { DrawerMenu } from './DrawerMenu';

// No navigator exists here: stub the router surface DrawerMenu touches and
// report the route focused (AdSlot unmounts on unfocused routes).
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  usePathname: () => '/',
  useIsFocused: () => true,
}));

let mockIsOpen = true;
let mockIsFullyOpen = false;
let mockTimingCallbacks: Array<(finished?: boolean) => void> = [];

jest.mock('@/hooks/use-mobile-ads-readiness', () => ({
  useMobileAdsReadiness: jest.fn(() => ({
    canRequestAds: true,
    initialized: true,
  })),
}));

const mockUseMobileAdsReadiness = jest.mocked(useMobileAdsReadiness);

jest.mock('react-native-google-mobile-ads', () => ({
  BannerAd: 'BannerAd',
  BannerAdSize: {
    ANCHORED_ADAPTIVE_BANNER: 'anchored-adaptive-banner',
  },
}));

// Mock SafeAreaProvider / useSafeAreaInsets cleanly
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 40, bottom: 20, left: 0, right: 0 }),
}));

// Mock optional gesture handler to avoid real native Gesture Handler requirements in test environment
jest.mock('@/lib/optional-gesture-handler', () => {
  const mockPanGesture = {
    activeOffsetX: jest.fn().mockReturnThis(),
    onUpdate: jest.fn().mockReturnThis(),
    onEnd: jest.fn().mockReturnThis(),
  };
  return {
    getOptionalGestureHandlerRuntime: () => ({
      Gesture: {
        Pan: () => mockPanGesture,
      },
      GestureDetector: ({ children }: { children: unknown }) => children,
      GestureHandlerRootView: ({ children }: { children: unknown }) => children,
    }),
  };
});

// Mock Reanimated cleanly
jest.mock('react-native-reanimated', () => {
  const { View, Text } =
    jest.requireActual<typeof import('react-native')>('react-native');
  const makeSharedValue = (init: number) => {
    let _value = init;
    return {
      get value() {
        return _value;
      },
      set value(v: number) {
        _value = v;
      },
      get: () => _value,
      set: (v: number) => {
        _value = v;
      },
    };
  };

  return {
    default: { View, Text },
    View,
    Text,
    cancelAnimation: jest.fn(),
    Easing: {
      in: jest.fn(),
      out: jest.fn(),
      cubic: jest.fn(),
    },
    runOnJS: (fn: (...args: unknown[]) => unknown) => fn,
    useSharedValue: makeSharedValue,
    useAnimatedStyle: () => ({}),
    withTiming: (
      value: number,
      _config?: unknown,
      callback?: (finished?: boolean) => void
    ) => {
      if (callback) mockTimingCallbacks.push(callback);
      return value;
    },
  };
});

function mockSetFullyOpen(fullyOpen: boolean): void {
  mockIsFullyOpen = fullyOpen;
}
jest.mock('@/stores/drawer-store', () => ({
  useDrawerStore: () => ({
    isOpen: mockIsOpen,
    isFullyOpen: mockIsFullyOpen,
    closeDrawer: jest.fn(),
    setFullyOpen: mockSetFullyOpen,
  }),
}));

jest.mock('@/stores/auth-store', () => ({
  useAuthStore: () => ({
    user: null,
    isInitialized: true,
    signOut: jest.fn(),
  }),
}));

jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      card: '#ffffff',
      border: '#eeeeee',
      text: '#000000',
      textSecondary: '#666666',
      muted: '#f5f5f5',
      foreground: '#000000',
      background: '#ffffff',
      icon: '#333333',
    },
    isDark: false,
  }),
}));

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));

jest.mock('@/components/storefront/GadgetPattern', () => {
  const { View } =
    jest.requireActual<typeof import('react-native')>('react-native');

  return {
    GadgetPattern: () => (
      <View
        accessible
        accessibilityLabel="Decorative technology backdrop"
        accessibilityRole="image"
      />
    ),
  };
});

describe('DrawerMenu', () => {
  beforeEach(() => {
    mockIsOpen = true;
    mockIsFullyOpen = false;
    mockTimingCallbacks = [];
  });

  it('renders correctly with GadgetPattern background decoration', () => {
    render(<DrawerMenu />);

    expect(
      screen.getByRole('image', { name: 'Decorative technology backdrop' })
    ).toBeTruthy();
  });

  it('does not mount the decorative backdrop while the drawer is closed', () => {
    mockIsOpen = false;

    render(<DrawerMenu />);

    expect(
      screen.queryByRole('image', { name: 'Decorative technology backdrop' })
    ).toBeNull();
  });

  it('mounts the footer ad only between the open and close animations', async () => {
    // Regression: isOpen flips when the slide starts, so mounting on it
    // would request and attribute impressions while the drawer is still
    // off-screen; ownership transfers only on animation completion.
    process.env.EXPO_PUBLIC_MOBILE_ADS_ENABLED = 'true';
    try {
      mockIsOpen = true;
      const view = render(<DrawerMenu />);
      expect(screen.queryByTestId('ad-slot-footer-anchor')).toBeNull();

      await act(async () => {
        mockTimingCallbacks.shift()?.(true);
      });
      view.rerender(<DrawerMenu />);
      expect(screen.queryByTestId('ad-slot-footer-anchor')).not.toBeNull();

      mockIsOpen = false;
      view.rerender(<DrawerMenu />);
      expect(screen.queryByTestId('ad-slot-footer-anchor')).not.toBeNull();

      // The mocked shared values re-fire the effect on every render, so the
      // close callback is last in the queue.
      await act(async () => {
        mockTimingCallbacks.at(-1)?.(true);
      });
      view.rerender(<DrawerMenu />);
      expect(screen.queryByTestId('ad-slot-footer-anchor')).toBeNull();
      expect(mockUseMobileAdsReadiness).toHaveBeenCalled();
    } finally {
      delete process.env.EXPO_PUBLIC_MOBILE_ADS_ENABLED;
    }
  });

  it('keeps the decorative backdrop mounted until the close animation finishes', async () => {
    const view = render(<DrawerMenu />);
    mockTimingCallbacks.length = 0;

    mockIsOpen = false;
    view.rerender(<DrawerMenu />);

    expect(
      screen.getByRole('image', { name: 'Decorative technology backdrop' })
    ).toBeTruthy();

    await act(async () => {
      mockTimingCallbacks.shift()?.(true);
    });

    expect(
      screen.queryByRole('image', { name: 'Decorative technology backdrop' })
    ).toBeNull();
  });

  it('keeps the decorative backdrop when the close animation is interrupted', () => {
    const view = render(<DrawerMenu />);
    mockTimingCallbacks.length = 0;

    mockIsOpen = false;
    view.rerender(<DrawerMenu />);

    act(() => {
      mockTimingCallbacks.shift()?.(false);
    });

    expect(
      screen.getByRole('image', { name: 'Decorative technology backdrop' })
    ).toBeTruthy();
  });
});
