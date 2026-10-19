import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      background: '#020617',
      text: '#f8fafc',
      textMuted: '#94a3b8',
      textSecondary: '#cbd5e1',
    },
  }),
}));
vi.mock('react-native', () => ({
  StyleSheet: { create: (styles: Record<string, unknown>) => styles },
  Text: ({
    children,
    ellipsizeMode,
    numberOfLines,
  }: {
    children?: ReactNode;
    ellipsizeMode?: string;
    numberOfLines?: number;
  }) => (
    <span
      data-ellipsize-mode={ellipsizeMode}
      data-number-of-lines={numberOfLines}
    >
      {children}
    </span>
  ),
  View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

import { ExpenseListSectionHeader } from './ExpenseListSectionHeader';

describe('ExpenseListSectionHeader', () => {
  it('renders a group label with its total and count', () => {
    render(
      <ExpenseListSectionHeader
        count={2}
        currency="NGN"
        label="Maintenance"
        total={40_000}
        variant="group"
      />
    );

    expect(screen.getByText('Maintenance')).toBeInTheDocument();
    expect(screen.getByText(/40,000/)).toBeInTheDocument();
    expect(screen.getByText('2 expenses')).toBeInTheDocument();
  });

  it('keeps long labels to one line while preserving the summary', () => {
    render(
      <ExpenseListSectionHeader
        count={1}
        currency="NGN"
        label="Group unavailable · 111111111111"
        total={10_000}
        variant="group"
      />
    );

    expect(
      screen.getByText('Group unavailable · 111111111111')
    ).toHaveAttribute('data-number-of-lines', '1');
    expect(screen.getByText(/10,000/)).toBeInTheDocument();
  });
});
