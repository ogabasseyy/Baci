import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import type { ReactNode, RefObject } from 'react';
import type { TextInputInstance } from 'react-native';
import { Modal, Platform, StyleSheet, type ViewProps } from 'react-native';
import { ChatModal } from './ChatModal';
import type { ChatMessage } from './types';

type MockFlashListProps = {
  data: ChatMessage[];
  renderItem: (info: { item: ChatMessage }) => ReactNode;
  ListFooterComponent?: ReactNode;
};

const mockUseKeyboard = jest.fn(() => ({
  dismissKeyboard: jest.fn(),
  isKeyboardVisible: false,
  keyboardHeight: 0,
  withKeyboardDismiss: <T extends (...args: never[]) => unknown>(handler: T) =>
    handler,
}));
const mockUseSafeAreaInsets = jest.fn(() => ({
  bottom: 34,
  left: 0,
  right: 0,
  top: 0,
}));
const mockUseSafeAreaInsetsProviderState = jest.fn();

jest.mock('@shopify/flash-list', () => {
  const React = jest.requireActual('react') as typeof import('react');
  const { View } =
    jest.requireActual<typeof import('react-native')>('react-native');

  return {
    FlashList: ({
      data,
      renderItem,
      ListFooterComponent,
    }: MockFlashListProps) =>
      React.createElement(
        View,
        { testID: 'chat-message-list' },
        data.map((item) =>
          React.createElement(View, { key: item.id }, renderItem({ item }))
        ),
        ListFooterComponent
      ),
  };
});

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'dark',
}));

jest.mock('@/components/storefront/GadgetPattern', () => ({
  GadgetPattern: 'GadgetPattern',
}));

jest.mock('@/hooks/use-keyboard', () => ({
  useKeyboard: () => mockUseKeyboard(),
}));

jest.mock('react-native-safe-area-context', () => {
  const React = jest.requireActual('react') as typeof import('react');
  const { View } =
    jest.requireActual<typeof import('react-native')>('react-native');
  const SafeAreaContext = React.createContext(false);

  return {
    SafeAreaProvider: ({
      children,
      ...props
    }: { children?: ReactNode } & ViewProps) => {
      return React.createElement(
        SafeAreaContext.Provider,
        { value: true },
        React.createElement(
          View,
          { ...props, testID: 'chat-safe-area-provider' },
          children
        )
      );
    },
    useSafeAreaInsets: () => {
      mockUseSafeAreaInsetsProviderState(React.useContext(SafeAreaContext));

      return mockUseSafeAreaInsets();
    },
  };
});

function renderChatModal() {
  const message: ChatMessage = {
    id: 'message-1',
    role: 'model',
    text: 'How can I help?',
    timestamp: new Date('2026-05-01T00:00:00.000Z'),
  };

  return render(
    <ChatModal
      visible={true}
      santaMode={false}
      messages={[message]}
      input=""
      isLoading={false}
      flatListRef={{ current: null }}
      inputRef={{ current: null } as RefObject<TextInputInstance | null>}
      onClose={jest.fn()}
      onSend={jest.fn()}
      onChangeInput={jest.fn()}
      onSuggestionPress={jest.fn()}
      onScrollToBottom={jest.fn()}
    />
  );
}

describe('ChatModal', () => {
  const originalPlatformOS = Platform.OS;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseSafeAreaInsets.mockReturnValue({
      bottom: 34,
      left: 0,
      right: 0,
      top: 0,
    });
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: originalPlatformOS,
    });
    mockUseKeyboard.mockReturnValue({
      dismissKeyboard: jest.fn(),
      isKeyboardVisible: false,
      keyboardHeight: 0,
      withKeyboardDismiss: <T extends (...args: never[]) => unknown>(
        handler: T
      ) => handler,
    });
  });

  it('uses a full-screen modal so keyboard avoidance has the full viewport', () => {
    const { UNSAFE_getByType } = renderChatModal();

    expect(UNSAFE_getByType(Modal).props.presentationStyle).toBe('fullScreen');
  });

  it('creates a safe-area provider inside the modal root', () => {
    renderChatModal();

    expect(screen.getByTestId('chat-safe-area-provider')).toBeOnTheScreen();
  });

  it('reads safe-area insets from content mounted under the modal provider', () => {
    renderChatModal();

    expect(mockUseSafeAreaInsetsProviderState).toHaveBeenCalledWith(true);
  });

  it('enables cross-platform keyboard avoiding protection on all platforms', () => {
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'ios',
    });
    const { rerender } = renderChatModal();
    expect(screen.getByTestId('keyboard-container')).toHaveProp(
      'enabled',
      true
    );

    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'android',
    });
    rerender(
      <ChatModal
        visible={true}
        santaMode={false}
        messages={[]}
        input=""
        isLoading={false}
        flatListRef={{ current: null }}
        inputRef={{ current: null } as RefObject<TextInputInstance | null>}
        onClose={jest.fn()}
        onSend={jest.fn()}
        onChangeInput={jest.fn()}
        onSuggestionPress={jest.fn()}
        onScrollToBottom={jest.fn()}
      />
    );
    expect(screen.getByTestId('keyboard-container')).toHaveProp(
      'enabled',
      true
    );
  });

  it('keeps input container spaced off the home safe area boundary when keyboard is closed', () => {
    renderChatModal();

    expect(
      StyleSheet.flatten(screen.getByTestId('chat-input-container').props.style)
    ).toMatchObject({
      paddingBottom: 34,
    });
    expect(screen.getByLabelText('Chat message input')).toBeOnTheScreen();
  });

  it('falls back to bottom padding when there is no bottom inset', () => {
    mockUseSafeAreaInsets.mockReturnValue({
      bottom: 0,
      left: 0,
      right: 0,
      top: 0,
    });
    renderChatModal();

    expect(
      StyleSheet.flatten(screen.getByTestId('chat-input-container').props.style)
    ).toMatchObject({
      paddingBottom: 12,
    });
  });
});
