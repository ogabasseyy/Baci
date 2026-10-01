import { jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { ChatWidget } from './ChatWidget';
import { useDraggableFab } from './use-draggable-fab';

jest.mock('react-native-gesture-handler', () => {
  const { Pressable, View } =
    jest.requireActual<typeof import('react-native')>('react-native');

  return {
    GestureDetector: ({
      children,
      gesture,
    }: {
      children?: ReactNode;
      gesture?: unknown;
    }) => (
      <View testID="gesture-detector" accessibilityLabel={String(!!gesture)}>
        {children}
      </View>
    ),
    Touchable: Pressable,
  };
});

// Mock the three custom hooks
jest.mock('./use-chat', () => ({
  useChat: jest.fn(() => ({
    messages: [],
    input: '',
    setInput: jest.fn(),
    isLoading: false,
    flatListRef: { current: null },
    inputRef: { current: null },
    handleSend: jest.fn(),
    handleSuggestionPress: jest.fn(),
    scrollToBottom: jest.fn(),
  })),
}));

jest.mock('./use-draggable-fab', () => ({
  useDraggableFab: jest.fn(() => ({
    composedGesture: {},
    translateX: { value: 0 },
    translateY: { value: 0 },
    // Keep the animated scale surface available to the shared FAB mock.
    scale: { get: () => 1, value: 1 },
    isDragging: false,
    isOverDismissZone: false,
    isOnRight: true,
  })),
}));

jest.mock('./use-proactive-nudge', () => ({
  useProactiveNudge: jest.fn(() => ({
    proactiveMsg: null,
    nudgeFadeAnim: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
      setValue: jest.fn(),
    },
    dismissNudge: jest.fn(),
  })),
}));

// Mock UI store
const mockOpenChat = jest.fn();
const mockCloseChat = jest.fn();
const mockDismissChat = jest.fn();
const mockResetChatDismissal = jest.fn();
let mockIsChatOpen = false;
let mockIsChatDismissed = false;

jest.mock('@/stores/ui-store', () => ({
  useUIStore: jest.fn(
    (
      selector: (state: {
        isChatOpen: typeof mockIsChatOpen;
        openChat: typeof mockOpenChat;
        closeChat: typeof mockCloseChat;
        isChatDismissed: typeof mockIsChatDismissed;
        dismissChat: typeof mockDismissChat;
        resetChatDismissal: typeof mockResetChatDismissal;
      }) => unknown
    ) => {
      const state = {
        isChatOpen: mockIsChatOpen,
        openChat: mockOpenChat,
        closeChat: mockCloseChat,
        isChatDismissed: mockIsChatDismissed,
        dismissChat: mockDismissChat,
        resetChatDismissal: mockResetChatDismissal,
      };
      return selector(state);
    }
  ),
}));

// Mock useColorScheme
jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: jest.fn(() => 'light'),
}));

// Mock expo-router usePathname
const mockUsePathname = jest.fn(() => '/');
jest.mock('expo-router', () => ({
  usePathname: jest.fn(() => mockUsePathname()),
  useRouter: jest.fn(() => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
  })),
  Link: 'Link',
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: jest.fn(() => ({
    top: 0,
    right: 0,
    bottom: 34,
    left: 0,
  })),
}));

// Mock ChatModal as a simple component
jest.mock('./ChatModal', () => ({
  ChatModal: jest.fn(() => null),
}));

// Mock styles
jest.mock('./styles', () => ({
  styles: {
    fabContainer: {},
    fab: {},
    aiBadge: {},
    aiBadgeText: {},
    fabEmoji: {},
    nudgeContainer: {},
    nudgeRight: {},
    nudgeLeft: {},
    nudgeBubble: {},
    nudgeText: {},
    nudgeClose: {},
    nudgeTailContainer: {},
    nudgeTailRight: {},
    nudgeTailLeft: {},
    nudgeDot1: {},
    nudgeDot2: {},
    dragIndicator: {},
    dragIndicatorText: {},
  },
}));

describe('ChatWidget', () => {
  const mockUseDraggableFab = useDraggableFab as jest.MockedFunction<
    typeof useDraggableFab
  >;

  beforeEach(() => {
    mockIsChatOpen = false;
    mockIsChatDismissed = false;
    mockOpenChat.mockClear();
    mockCloseChat.mockClear();
    mockDismissChat.mockClear();
    mockResetChatDismissal.mockClear();
    mockUsePathname.mockReturnValue('/');
  });

  it('renders the FAB button with the correct accessibility label', () => {
    render(<ChatWidget />);

    const fab = screen.getByRole('button', {
      name: 'Open chat assistant. Drag to move.',
    });
    expect(fab).toBeTruthy();
  });

  it('passes the draggable FAB gesture into GestureDetector', () => {
    render(<ChatWidget />);

    expect(mockUseDraggableFab).toHaveBeenCalledWith(
      124,
      mockDismissChat,
      expect.any(Function)
    );
    expect(screen.getByTestId('gesture-detector')).toHaveProp(
      'accessibilityLabel',
      'true'
    );
  });

  it('opens chat from the accessibility activation path', () => {
    render(<ChatWidget />);

    fireEvent(
      screen.getByRole('button', {
        name: 'Open chat assistant. Drag to move.',
      }),
      'accessibilityTap'
    );

    expect(mockOpenChat).toHaveBeenCalledTimes(1);
  });

  it('shows the AI badge text on the FAB', () => {
    render(<ChatWidget />);

    expect(screen.getByText('AI')).toBeTruthy();
  });

  it('returns null when pathname matches a hidden route (/checkout)', () => {
    mockUsePathname.mockReturnValue('/checkout');
    const { toJSON } = render(<ChatWidget />);

    expect(toJSON()).toBeNull();
  });

  it('returns null on the cart route', () => {
    mockUsePathname.mockReturnValue('/cart');
    const { toJSON } = render(<ChatWidget />);

    expect(toJSON()).toBeNull();
  });

  it('returns null when pathname starts with /auth/login', () => {
    mockUsePathname.mockReturnValue('/auth/login');
    const { toJSON } = render(<ChatWidget />);

    expect(toJSON()).toBeNull();
  });

  it('returns null for /order-success route', () => {
    mockUsePathname.mockReturnValue('/order-success');
    const { toJSON } = render(<ChatWidget />);

    expect(toJSON()).toBeNull();
  });

  it.each([
    '/utilities/power',
    '/payment-gateway',
    '/bank-transfer',
    '/crypto-payment',
  ])('returns null for hidden payment route %s', (pathname) => {
    mockUsePathname.mockReturnValue(pathname);
    const { toJSON } = render(<ChatWidget />);

    expect(toJSON()).toBeNull();
  });

  it('renders the FAB when on a non-hidden route', () => {
    mockUsePathname.mockReturnValue('/home');
    render(<ChatWidget />);

    expect(
      screen.getByRole('button', {
        name: 'Open chat assistant. Drag to move.',
      })
    ).toBeTruthy();
  });

  it('renders santa emoji when santaMode is true', () => {
    render(<ChatWidget santaMode={true} />);

    expect(screen.getByText('🎅')).toBeTruthy();
  });

  it('does not render santa emoji when santaMode is false', () => {
    render(<ChatWidget santaMode={false} />);

    expect(screen.queryByText('🎅')).toBeNull();
  });

  it('returns null when chatbot is dismissed', () => {
    mockIsChatDismissed = true;
    const { toJSON } = render(<ChatWidget />);

    expect(toJSON()).toBeNull();
  });

  it('preserves chatbot dismissal when already on the home screen', () => {
    mockIsChatDismissed = true;
    mockUsePathname.mockReturnValue('/');
    render(<ChatWidget />);

    expect(mockResetChatDismissal).not.toHaveBeenCalled();
  });

  it('resets chatbot dismissal after navigating back to home screen', () => {
    mockIsChatDismissed = true;
    mockUsePathname.mockReturnValue('/products/iphone-15');
    const { rerender } = render(<ChatWidget />);

    mockUsePathname.mockReturnValue('/');
    rerender(<ChatWidget />);

    expect(mockResetChatDismissal).toHaveBeenCalled();
  });
});
