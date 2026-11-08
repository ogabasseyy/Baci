import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { FeedbackSubmitButton } from './FeedbackSubmitButton';

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
    Pressable: ({
      children,
      disabled,
      onPress,
      style,
      testID,
    }: NativeProps & { disabled?: boolean }) =>
      React.createElement(
        'button',
        {
          'data-testid': testID,
          disabled,
          onClick: onPress,
          style: flattenStyle(style),
          type: 'button',
        },
        children
      ),
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
  };
});

vi.mock('@react-native-vector-icons/ionicons', () => ({
  default: ({ color, name }: { color?: string; name: string }) => (
    <span data-color={color} data-testid={`icon-${name}`} />
  ),
  __esModule: true,
}));

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      primary: '#2563eb',
      textOnPrimary: themeTextOnPrimary,
    },
  }),
}));

describe('FeedbackSubmitButton', () => {
  it('renders idle button with themed icon and text', () => {
    const onPress = vi.fn();
    render(<FeedbackSubmitButton isSending={false} onPress={onPress} />);

    expect(screen.getByTestId('icon-paper-plane')).toHaveAttribute(
      'data-color',
      themeTextOnPrimary
    );

    const submitText = screen.getByText('Submit Feedback');
    expect(submitText).toHaveAttribute('data-style-color', themeTextOnPrimary);

    fireEvent.click(submitText);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('renders loading indicator with dynamic token when sending', () => {
    const onPress = vi.fn();
    render(<FeedbackSubmitButton isSending={true} onPress={onPress} />);

    const indicator = screen.getByTestId('activity-indicator');
    expect(indicator).toHaveAttribute('data-color', themeTextOnPrimary);
    expect(screen.queryByText('Submit Feedback')).not.toBeInTheDocument();
  });
});
