import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FeedbackSubmitButton } from './FeedbackSubmitButton';
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
      primary: '#2563eb',
      textOnPrimary: themeTextOnPrimary,
    },
  }),
}));

describe('FeedbackSubmitButton', () => {
  describe('bugfix: hardcoded #FFFFFF colors ignore dark mode tokens', () => {
    it('renders idle button with themed icon and text', () => {
      const onPress = vi.fn();
      render(<FeedbackSubmitButton isSending={false} onPress={onPress} />);

      expect(screen.getByTestId('icon-paper-plane')).toHaveAttribute(
        'data-color',
        themeTextOnPrimary
      );

      const submitText = screen.getByText('Submit Feedback');
      expect(submitText).toHaveAttribute(
        'data-style-color',
        themeTextOnPrimary
      );

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
});
