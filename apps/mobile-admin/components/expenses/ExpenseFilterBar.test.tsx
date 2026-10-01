import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      border: '#334155',
      card: '#111827',
      primary: '#3b82f6',
      text: '#f8fafc',
      textSecondary: '#cbd5e1',
    },
  }),
}));

vi.mock('@react-native-vector-icons/ionicons', () => ({
  default: () => <span>icon</span>,
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
  StyleSheet: { create: (styles: Record<string, unknown>) => styles },
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

import { ExpenseFilterBar } from './ExpenseFilterBar';

describe('ExpenseFilterBar', () => {
  it('opens the accessible filter sheet and exposes its active-filter count', () => {
    const onOpen = vi.fn();

    render(<ExpenseFilterBar activeFilterCount={2} onOpen={onOpen} />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Open expense filters (2 active)' })
    );

    expect(onOpen).toHaveBeenCalledOnce();
    expect(screen.getByText('Filters')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('does not announce an active count when all filters are reset', () => {
    render(<ExpenseFilterBar activeFilterCount={0} onOpen={vi.fn()} />);

    expect(
      screen.getByRole('button', { name: 'Open expense filters' })
    ).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });
});
