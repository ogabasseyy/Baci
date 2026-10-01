import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DARK_COLORS } from '@/constants/theme';
import { ExpenseDependencyError } from './ExpenseDependencyError';

vi.mock('@react-native-vector-icons/ionicons', () => ({
  Ionicons: ({ name }: { name: string }) => <span data-icon={name} />,
  default: ({ name }: { name: string }) => <span data-icon={name} />,
  __esModule: true,
}));

vi.mock('react-native', () => ({
  Pressable: ({
    accessibilityLabel,
    children,
    onPress,
  }: {
    accessibilityLabel?: string;
    children?: ReactNode;
    onPress?: () => void;
  }) => (
    <button aria-label={accessibilityLabel} onClick={onPress} type="button">
      {children}
    </button>
  ),
  StyleSheet: {
    create: (styles: Record<string, unknown>) => styles,
    hairlineWidth: 1,
  },
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

const colors = DARK_COLORS;

describe('ExpenseDependencyError', () => {
  it('renders the supplied message and retries when pressed', () => {
    const onRetry = vi.fn();

    render(
      <ExpenseDependencyError
        colors={colors}
        message="Expense groups are unavailable"
        onRetry={onRetry}
      />
    );

    expect(
      screen.getByText('Expense groups are unavailable')
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
