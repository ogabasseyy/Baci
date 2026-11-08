import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  type NativeProps,
  themeTextOnPrimary,
} from '@/components/feedback/feedback-test-helpers';

vi.mock('react-native', async () => {
  const { createFeedbackReactNativeMock } = await import(
    '@/components/feedback/feedback-test-helpers'
  );
  return createFeedbackReactNativeMock();
});

vi.mock('react-native-safe-area-context', async () => {
  const { flattenStyle } = await import(
    '@/components/feedback/feedback-test-helpers'
  );
  return {
    SafeAreaView: ({ children, style }: NativeProps) => (
      <main style={flattenStyle(style)}>{children}</main>
    ),
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
  describe('bugfix: hardcoded #FFFFFF colors ignore dark mode tokens', () => {
    it('uses dynamic textOnPrimary token for submit button icon and label', () => {
      render(<SendFeedbackScreen />);

      expect(screen.getByTestId('icon-paper-plane')).toHaveAttribute(
        'data-color',
        themeTextOnPrimary
      );

      const submitText = screen.getByText('Submit Feedback');
      expect(submitText).toHaveAttribute(
        'data-style-color',
        themeTextOnPrimary
      );
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
});
