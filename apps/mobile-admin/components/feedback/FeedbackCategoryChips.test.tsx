import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  FEEDBACK_CATEGORIES,
  FeedbackCategoryChips,
} from './FeedbackCategoryChips';

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
    View: ({ children, style }: NativeProps) =>
      React.createElement('div', { style: flattenStyle(style) }, children),
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
      cardHover: '#f3f4f6',
      primary: '#2563eb',
      text: '#111827',
      textOnPrimary: themeTextOnPrimary,
    },
  }),
}));

describe('FeedbackCategoryChips', () => {
  it('applies unselected style when category is not in selected list', () => {
    const onToggle = vi.fn();
    render(
      <FeedbackCategoryChips
        categories={FEEDBACK_CATEGORIES}
        selectedCategories={[]}
        onToggleCategory={onToggle}
      />
    );

    const chipText = screen.getByText('App Experience');
    expect(chipText).toHaveAttribute('data-style-color', '#111827');
    expect(screen.getByTestId('icon-phone-portrait-outline')).toHaveAttribute(
      'data-color',
      '#111827'
    );
  });

  it('applies textOnPrimary style when category is selected', () => {
    const onToggle = vi.fn();
    render(
      <FeedbackCategoryChips
        categories={FEEDBACK_CATEGORIES}
        selectedCategories={['experience']}
        onToggleCategory={onToggle}
      />
    );

    const chipText = screen.getByText('App Experience');
    expect(chipText).toHaveAttribute('data-style-color', themeTextOnPrimary);
    expect(screen.getByTestId('icon-phone-portrait-outline')).toHaveAttribute(
      'data-color',
      themeTextOnPrimary
    );

    fireEvent.click(screen.getByText('Features'));
    expect(onToggle).toHaveBeenCalledWith('features');
  });
});
