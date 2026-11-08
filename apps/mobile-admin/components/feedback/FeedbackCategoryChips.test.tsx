import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  FEEDBACK_CATEGORIES,
  FeedbackCategoryChips,
} from './FeedbackCategoryChips';
import { themeTextOnPrimary } from './feedback-test-helpers';

vi.mock('react-native', async () => {
  const { createFeedbackReactNativeMock } = await import(
    './feedback-test-helpers'
  );
  return createFeedbackReactNativeMock();
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
  describe('bugfix: hardcoded #FFFFFF colors ignore dark mode tokens', () => {
    it('applies unselected style when category is not in selected list', () => {
      const onToggle = vi.fn();
      render(
        <FeedbackCategoryChips
          categories={FEEDBACK_CATEGORIES}
          onToggleCategory={onToggle}
          selectedCategories={[]}
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
          onToggleCategory={onToggle}
          selectedCategories={['experience']}
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
});
