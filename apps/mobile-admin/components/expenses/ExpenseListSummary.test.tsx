import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      primary: '#3b82f6',
      textOnPrimary: '#ffffff',
    },
    shadows: { md: {} },
  }),
}));
vi.mock('@react-native-vector-icons/ionicons', () => ({
  default: () => <span>icon</span>,
  __esModule: true,
}));
vi.mock('react-native', () => ({
  StyleSheet: { create: (styles: Record<string, unknown>) => styles },
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

import { ExpenseListSummary } from './ExpenseListSummary';

describe('ExpenseListSummary', () => {
  it('labels and formats the total supplied by the visible expense query', () => {
    render(
      <ExpenseListSummary
        currency="NGN"
        label="Filtered total"
        total={12_500}
      />
    );

    expect(screen.getByText('Filtered total')).toBeInTheDocument();
    expect(screen.getByText(/12,500/)).toBeInTheDocument();
    expect(screen.getByText('recorded spending')).toBeInTheDocument();
  });

  it('renders zero totals without hiding the summary', () => {
    render(
      <ExpenseListSummary currency="NGN" label="Total this Month" total={0} />
    );
    expect(screen.getByText('Total this Month')).toBeInTheDocument();
    expect(screen.getByText(/0\.00$/)).toBeInTheDocument();
    expect(screen.getByText('recorded spending')).toBeInTheDocument();
  });
});
