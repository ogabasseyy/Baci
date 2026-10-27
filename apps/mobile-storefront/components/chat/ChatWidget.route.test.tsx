import { jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { ChatWidget } from './ChatWidget';

const mockUsePathname = jest.fn(() => '/quiz');

jest.mock('react-native-gesture-handler', () => {
  const { View } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    GestureDetector: ({ children }: { children?: ReactNode }) => (
      <View>{children}</View>
    ),
  };
});

jest.mock('@react-native-vector-icons/ionicons', () => 'Ionicons');
jest.mock('expo-haptics', () => ({
  ImpactFeedbackStyle: { Medium: 'medium' },
  impactAsync: jest.fn(),
}));
jest.mock('expo-router', () => ({
  usePathname: jest.fn(() => mockUsePathname()),
}));
jest.mock('react-native-reanimated', () => {
  const { View } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    __esModule: true,
    default: { View },
    useAnimatedStyle: jest.fn(() => ({})),
  };
});
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: jest.fn(() => ({
    bottom: 0,
    left: 0,
    right: 0,
    top: 0,
  })),
}));
jest.mock('zustand/react/shallow', () => ({
  useShallow: (selector: unknown) => selector,
}));
jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: jest.fn(() => 'light'),
}));
jest.mock('@/constants/Colors', () => ({
  __esModule: true,
  BRAND: { primary: '#ff0000' },
  default: {
    light: {
      card: '#fff',
      border: '#000',
      text: '#000',
      textSecondary: '#666',
    },
  },
}));
jest.mock('@/constants/layout', () => ({
  getChatWidgetBottomOffset: jest.fn((offset: number) => offset),
}));
jest.mock('@/lib/optional-gesture-handler', () => ({
  getOptionalGestureHandlerRuntime: jest.fn(() => ({
    GestureDetector: ({ children }: { children?: ReactNode }) => children,
  })),
}));
jest.mock('@/stores/ui-store', () => ({
  useUIStore: jest.fn((selector: (state: unknown) => unknown) =>
    selector({
      closeChat: jest.fn(),
      dismissChat: jest.fn(),
      isChatDismissed: false,
      isChatOpen: false,
      openChat: jest.fn(),
      resetChatDismissal: jest.fn(),
    })
  ),
}));
jest.mock('./ChatModal', () => ({ ChatModal: jest.fn(() => null) }));
jest.mock('./styles', () => ({
  styles: new Proxy({}, { get: () => ({}) }),
}));
jest.mock('./use-chat', () => ({
  useChat: jest.fn(() => ({
    flatListRef: { current: null },
    handleSend: jest.fn(),
    handleSuggestionPress: jest.fn(),
    input: '',
    inputRef: { current: null },
    isLoading: false,
    messages: [],
    scrollToBottom: jest.fn(),
    setInput: jest.fn(),
  })),
}));
jest.mock('./use-draggable-fab', () => ({
  useDraggableFab: jest.fn(() => ({
    composedGesture: null,
    isDragging: false,
    isOnRight: true,
    isOverDismissZone: false,
    translateX: { value: 0 },
    translateY: { value: 0 },
  })),
}));
jest.mock('./use-proactive-nudge', () => ({
  useProactiveNudge: jest.fn(() => ({
    dismissNudge: jest.fn(),
    nudgeFadeAnim: { value: 0 },
    proactiveMsg: null,
  })),
}));

describe('ChatWidget route visibility', () => {
  it.each([
    '/wallet',
    '/wallet/',
    '/(tabs)/wallet',
    '/wallet/manage-cards',
    '/wallet/usdt',
    '/wallet/setup',
    '/wallet/savings',
    '/wallet/savings/start',
    '/wallet/savings/plan-1',
    '/(tabs)/wallet/savings/start',
    '/savings/funding',
  ])('hides floating chat on wallet, setup and plan route %s', (pathname) => {
    mockUsePathname.mockReturnValue(pathname);

    const { toJSON } = render(<ChatWidget />);

    expect(toJSON()).toBeNull();
  });

  it.each([
    '/',
    '/(tabs)',
    '/(tabs)/',
    '/products/phone',
    '/category/phones',
    '/wallet-offers',
    '/(tabs)/wallet-offers',
    '/savings-guide',
    '/notifications',
    '/settings',
    '/settings/notifications',
    '/settings/privacy',
  ])('keeps global chat available on non-wallet route %s', (pathname) => {
    mockUsePathname.mockReturnValue(pathname);

    render(<ChatWidget />);

    expect(
      screen.getByRole('button', {
        name: 'Open chat assistant. Drag to move.',
      })
    ).toBeOnTheScreen();
  });

  it('hides chat when entering wallet and restores it after leaving wallet', () => {
    mockUsePathname.mockReturnValue('/');
    const { rerender } = render(<ChatWidget />);
    expect(
      screen.getByRole('button', {
        name: 'Open chat assistant. Drag to move.',
      })
    ).toBeOnTheScreen();

    mockUsePathname.mockReturnValue('/wallet');
    rerender(<ChatWidget />);
    expect(
      screen.queryByRole('button', {
        name: 'Open chat assistant. Drag to move.',
      })
    ).toBeNull();

    mockUsePathname.mockReturnValue('/products/phone');
    rerender(<ChatWidget />);
    expect(
      screen.getByRole('button', {
        name: 'Open chat assistant. Drag to move.',
      })
    ).toBeOnTheScreen();
  });

  it('returns null on the quiz route', () => {
    mockUsePathname.mockReturnValue('/quiz');

    const { toJSON } = render(<ChatWidget />);

    expect(toJSON()).toBeNull();
  });
});
