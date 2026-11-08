import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';

const themeTextOnPrimary = '#991122';

type StyleInput =
  | React.CSSProperties
  | readonly StyleInput[]
  | null
  | undefined
  | false;

type NativeProps = {
  children?: React.ReactNode;
  onPress?: () => void;
  style?: StyleInput;
  testID?: string;
};

function isStyleList(style: StyleInput): style is readonly StyleInput[] {
  return Array.isArray(style);
}

function flattenStyle(style: StyleInput): React.CSSProperties {
  if (!style) return {};
  if (isStyleList(style)) {
    const merged: React.CSSProperties = {};
    for (const item of style) {
      Object.assign(merged, flattenStyle(item));
    }
    return merged;
  }

  return style;
}

vi.mock('react-native', async () => {
  const React = await import('react');

  return {
    ActivityIndicator: ({ color }: { color?: string }) => (
      <div data-color={color} data-testid="activity-indicator" />
    ),
    Alert: { alert: vi.fn() },
    Pressable: ({ children, onPress, style, testID }: NativeProps) =>
      React.createElement(
        'button',
        {
          'data-testid': testID,
          onClick: onPress,
          style: flattenStyle(style),
          type: 'button',
        },
        children
      ),
    ScrollView: ({ children, style }: NativeProps) =>
      React.createElement('div', { style: flattenStyle(style) }, children),
    StatusBar: () => null,
    StyleSheet: {
      create: <T,>(styles: T) => styles,
    },
    Text: ({ children, style }: NativeProps) => {
      const flattenedStyle = flattenStyle(style);
      return React.createElement(
        'span',
        {
          'data-style-color': flattenedStyle.color,
          style: flattenedStyle,
        },
        children
      );
    },
    TextInput: ({
      onChangeText,
      placeholder,
      value,
    }: {
      onChangeText?: (text: string) => void;
      placeholder?: string;
      value?: string;
    }) =>
      React.createElement('textarea', {
        onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) =>
          onChangeText?.(e.target.value),
        placeholder,
        value,
      }),
    View: ({ children, style }: NativeProps) =>
      React.createElement('div', { style: flattenStyle(style) }, children),
  };
});

vi.mock('react-native-safe-area-context', async () => {
  const React = await import('react');
  return {
    SafeAreaView: ({ children, style }: NativeProps) =>
      React.createElement('main', { style: flattenStyle(style) }, children),
  };
});

vi.mock('@react-native-vector-icons/ionicons', () => ({
  default: ({ color, name }: { color?: string; name: string }) => (
    <span data-color={color} data-testid={`icon-${name}`} />
  ),
  __esModule: true,
}));

vi.mock('expo-router', () => ({
  Stack: {
    Screen: () => null,
  },
  useRouter: () => ({ back: vi.fn() }),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'test-user-id' } }),
}));

vi.mock('@/hooks/useMerchant', () => ({
  useMerchant: () => ({ merchant: { id: 'test-merchant-id' } }),
}));

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      background: '#ffffff',
      border: '#d1d5db',
      card: '#ffffff',
      cardHover: '#f3f4f6',
      primary: '#2563eb',
      text: '#111827',
      textMuted: '#6b7280',
      textOnPrimary: themeTextOnPrimary,
      textSecondary: '#4b5563',
    },
    isDark: false,
    shadows: { sm: {} },
  }),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      insert: vi.fn().mockResolvedValue({ error: null }),
    }),
  },
}));

import SendFeedbackScreen from './send-feedback';

describe('SendFeedbackScreen theming', () => {
  it('uses dynamic textOnPrimary token for submit button icon and label', () => {
    render(<SendFeedbackScreen />);

    expect(screen.getByTestId('icon-paper-plane')).toHaveAttribute(
      'data-color',
      themeTextOnPrimary
    );

    const submitText = screen.getByText('Submit Feedback');
    expect(submitText).toHaveAttribute('data-style-color', themeTextOnPrimary);
  });

  it('uses dynamic textOnPrimary token for selected category chip icon and text', () => {
    render(<SendFeedbackScreen />);

    const chipButton = screen.getByText('App Experience').closest('button');
    expect(chipButton).toBeInTheDocument();

    // Before selection, unselected color is text (#111827)
    const chipTextBefore = screen.getByText('App Experience');
    expect(chipTextBefore).toHaveAttribute('data-style-color', '#111827');

    // Click to select category
    if (chipButton) {
      fireEvent.click(chipButton);
    }

    // After selection, icon and text receive textOnPrimary
    const chipTextAfter = screen.getByText('App Experience');
    expect(chipTextAfter).toHaveAttribute(
      'data-style-color',
      themeTextOnPrimary
    );
    expect(screen.getByTestId('icon-phone-portrait-outline')).toHaveAttribute(
      'data-color',
      themeTextOnPrimary
    );
  });
});
