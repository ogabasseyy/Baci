import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  FeedbackRatingSelector,
  RATING_EMOJIS,
  RATING_LABELS,
} from './FeedbackRatingSelector';

vi.mock('react-native', async () => {
  const { createFeedbackReactNativeMock } = await import(
    './feedback-test-helpers'
  );
  return createFeedbackReactNativeMock();
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
      <FeedbackRatingSelector onSelectRating={onSelectRating} rating={null} />
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
      <FeedbackRatingSelector onSelectRating={onSelectRating} rating={4} />
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
      <FeedbackRatingSelector onSelectRating={onSelectRating} rating={null} />
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
        onSelectRating={onSelectRating}
        rating={2}
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
