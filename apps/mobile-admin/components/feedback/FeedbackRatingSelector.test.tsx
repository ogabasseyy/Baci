import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  FeedbackRatingSelector,
  RATING_EMOJIS,
  RATING_LABELS,
} from './FeedbackRatingSelector';

type StyleInput =
  | React.CSSProperties
  | readonly StyleInput[]
  | null
  | undefined
  | false;

type NativeProps = {
  accessibilityLabel?: string;
  accessibilityRole?: string;
  accessibilityState?: { disabled?: boolean; selected?: boolean };
  children?: React.ReactNode;
  disabled?: boolean;
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
    Pressable: ({
      accessibilityLabel,
      accessibilityRole,
      accessibilityState,
      children,
      disabled,
      onPress,
      style,
      testID,
    }: NativeProps) => {
      const isDisabled = Boolean(disabled || accessibilityState?.disabled);
      const flattenedStyle = flattenStyle(style);
      return React.createElement(
        'button',
        {
          'aria-disabled': isDisabled,
          'aria-label': accessibilityLabel,
          'aria-pressed': accessibilityState?.selected,
          'data-border-color': flattenedStyle.borderColor,
          'data-opacity': flattenedStyle.opacity,
          'data-selected': accessibilityState?.selected ? 'true' : undefined,
          'data-testid': testID,
          disabled: isDisabled,
          onClick: isDisabled ? undefined : onPress,
          role: accessibilityRole,
          style: flattenedStyle,
          type: 'button',
        },
        children
      );
    },
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

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      cardHover: '#f3f4f6',
      primary: '#2563eb',
    },
  }),
}));

describe('FeedbackRatingSelector', () => {
  it('renders all rating emoji buttons and hides rating label when unselected', () => {
    const onSelectRating = vi.fn();
    render(
      <FeedbackRatingSelector rating={null} onSelectRating={onSelectRating} />
    );

    for (const emoji of RATING_EMOJIS) {
      expect(screen.getByText(emoji)).toBeInTheDocument();
    }

    for (const label of RATING_LABELS) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
  });

  it('renders selected rating styling, label, and accessible state', () => {
    const onSelectRating = vi.fn();
    render(
      <FeedbackRatingSelector rating={4} onSelectRating={onSelectRating} />
    );

    const goodLabel = screen.getByText('Good');
    expect(goodLabel).toBeInTheDocument();
    expect(goodLabel).toHaveAttribute('data-style-color', '#2563eb');

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(RATING_EMOJIS.length);

    const selectedButton = buttons[3];
    expect(selectedButton).toHaveAttribute('aria-pressed', 'true');
    expect(selectedButton).toHaveAttribute('data-border-color', '#2563eb');
    expect(selectedButton).toHaveAttribute('aria-label', 'Good, rating 4 of 5');

    const unselectedButton = buttons[0];
    expect(unselectedButton).toHaveAttribute('aria-pressed', 'false');
    expect(unselectedButton).toHaveAttribute(
      'data-border-color',
      'transparent'
    );
  });

  it('invokes onSelectRating callback with corresponding 1-based rating index', () => {
    const onSelectRating = vi.fn();
    render(
      <FeedbackRatingSelector rating={null} onSelectRating={onSelectRating} />
    );

    fireEvent.click(screen.getByText('😍'));
    expect(onSelectRating).toHaveBeenCalledTimes(1);
    expect(onSelectRating).toHaveBeenCalledWith(5);
  });

  it('supports disabled state and ignores rating selections', () => {
    const onSelectRating = vi.fn();
    render(
      <FeedbackRatingSelector
        disabled={true}
        rating={2}
        onSelectRating={onSelectRating}
      />
    );

    const buttons = screen.getAllByRole('button');
    for (const button of buttons) {
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('aria-disabled', 'true');
      expect(button).toHaveAttribute('data-opacity', '0.5');
    }

    fireEvent.click(screen.getByText('🙂'));
    expect(onSelectRating).not.toHaveBeenCalled();
  });
});
