import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_EXPENSE_FILTERS } from './expense-filters';

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      border: '#334155',
      card: '#111827',
      inputBg: '#0f172a',
      primary: '#3b82f6',
      primaryLight: '#dbeafe',
      text: '#f8fafc',
      textOnPrimary: '#ffffff',
      textSecondary: '#cbd5e1',
    },
  }),
}));

vi.mock('@react-native-vector-icons/ionicons', () => ({
  default: () => <span>icon</span>,
  __esModule: true,
}));

vi.mock('@/components/ui/AppDatePickerField', () => ({
  AppDatePickerField: ({ onConfirm }: { onConfirm: (date: Date) => void }) => (
    <button
      aria-label="Confirm selected filter date"
      onClick={() => onConfirm(new Date(2026, 7, 3))}
      type="button"
    >
      Confirm date
    </button>
  ),
}));

vi.mock('@/components/ui/AppSheetModal', () => ({
  AppSheetModal: ({
    children,
    visible,
  }: {
    children?: ReactNode;
    visible: boolean;
  }) =>
    visible ? (
      <section aria-label="expense-filters-sheet">{children}</section>
    ) : null,
}));

vi.mock('react-native', () => ({
  Pressable: ({
    accessibilityLabel,
    accessibilityState,
    children,
    onPress,
  }: {
    accessibilityLabel?: string;
    accessibilityState?: { selected?: boolean };
    children?: ReactNode;
    onPress?: () => void;
  }) => (
    <button
      aria-label={accessibilityLabel}
      data-selected={accessibilityState?.selected}
      onClick={onPress}
      type="button"
    >
      {children}
    </button>
  ),
  ScrollView: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  StyleSheet: { create: (styles: Record<string, unknown>) => styles },
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

import { ExpenseFiltersSheet } from './ExpenseFiltersSheet';

const branches = [
  { id: 'branch-1', name: 'Lekki' },
  { id: 'branch-2', name: 'Ikeja' },
];
const groups = [
  {
    archived_at: null,
    created_at: '2026-08-01T00:00:00.000Z',
    id: '9ba1db37-69b5-4445-8a28-e90794b1841d',
    merchant_id: 'cae013e3-719e-4baa-9ab9-45d080ce23ea',
    name: 'Operations',
    updated_at: '2026-08-01T00:00:00.000Z',
  },
];

describe('ExpenseFiltersSheet', () => {
  it('surfaces filter dependency failures with a retry action', () => {
    const onRetry = vi.fn();

    render(
      <ExpenseFiltersSheet
        branchScope={{ type: 'all' }}
        branches={branches}
        dependencyError={new Error('branches unavailable')}
        filters={DEFAULT_EXPENSE_FILTERS}
        groups={groups}
        onApply={vi.fn()}
        onClose={vi.fn()}
        onRetry={onRetry}
        visible
      />
    );

    expect(
      screen.getByText('Some filter options could not load.')
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Retry loading expense filter options',
      })
    );
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('collects date, category, branch, and group choices before applying them', () => {
    const onApply = vi.fn();

    render(
      <ExpenseFiltersSheet
        branchScope={{ type: 'all' }}
        branches={branches}
        filters={DEFAULT_EXPENSE_FILTERS}
        groups={groups}
        onApply={onApply}
        onClose={vi.fn()}
        visible
      />
    );

    expect(
      screen.getByRole('button', { name: 'Select this month' })
    ).toHaveAttribute('data-selected', 'true');
    expect(
      screen.getByRole('button', { name: 'Filter category all categories' })
    ).toHaveAttribute('data-selected', 'true');
    expect(
      screen.getByRole('button', { name: 'Filter branch all branches' })
    ).toHaveAttribute('data-selected', 'true');
    expect(
      screen.getByRole('button', { name: 'Filter all expense groups' })
    ).toHaveAttribute('data-selected', 'true');

    fireEvent.click(
      screen.getByRole('button', { name: 'Select custom range' })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Choose filter start date' })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm selected filter date' })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Filter category Travel' })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Filter branch Lekki' })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Filter group Operations' })
    );

    expect(
      screen.getByRole('button', { name: 'Select custom range' })
    ).toHaveAttribute('data-selected', 'true');
    expect(
      screen.getByRole('button', { name: 'Filter category Travel' })
    ).toHaveAttribute('data-selected', 'true');
    expect(
      screen.getByRole('button', { name: 'Filter branch Lekki' })
    ).toHaveAttribute('data-selected', 'true');
    expect(
      screen.getByRole('button', { name: 'Filter group Operations' })
    ).toHaveAttribute('data-selected', 'true');
    fireEvent.click(
      screen.getByRole('button', { name: 'Apply expense filters' })
    );

    expect(onApply).toHaveBeenCalledWith({
      branchId: 'branch-1',
      category: 'Travel',
      datePreset: 'custom',
      endDate: null,
      groupId: '9ba1db37-69b5-4445-8a28-e90794b1841d',
      startDate: '2026-08-03',
    });
  });

  it('offers ungrouped filtering and resets every choice to its defaults', () => {
    const onApply = vi.fn();
    const onClose = vi.fn();

    render(
      <ExpenseFiltersSheet
        branchScope={{ type: 'all' }}
        branches={branches}
        filters={{ ...DEFAULT_EXPENSE_FILTERS, groupId: 'ungrouped' }}
        groups={groups}
        onApply={onApply}
        onClose={onClose}
        visible
      />
    );

    expect(
      screen.getByRole('button', { name: 'Filter ungrouped expenses' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Filter ungrouped expenses' })
    ).toHaveAttribute('data-selected', 'true');
    fireEvent.click(
      screen.getByRole('button', { name: 'Reset expense filters' })
    );

    expect(onApply).toHaveBeenCalledWith(DEFAULT_EXPENSE_FILTERS);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('restores selected choices when the sheet reopens', () => {
    const filters = {
      branchId: 'branch-1',
      category: 'Travel' as const,
      datePreset: 'custom' as const,
      endDate: '2026-08-08',
      groupId: '9ba1db37-69b5-4445-8a28-e90794b1841d',
      startDate: '2026-08-03',
    };
    const { rerender } = render(
      <ExpenseFiltersSheet
        branchScope={{ type: 'all' }}
        branches={branches}
        filters={filters}
        groups={groups}
        onApply={vi.fn()}
        onClose={vi.fn()}
        visible={false}
      />
    );

    rerender(
      <ExpenseFiltersSheet
        branchScope={{ type: 'all' }}
        branches={branches}
        filters={filters}
        groups={groups}
        onApply={vi.fn()}
        onClose={vi.fn()}
        visible
      />
    );

    expect(
      screen.getByRole('button', { name: 'Select custom range' })
    ).toHaveAttribute('data-selected', 'true');
    expect(
      screen.getByRole('button', { name: 'Filter category Travel' })
    ).toHaveAttribute('data-selected', 'true');
    expect(
      screen.getByRole('button', { name: 'Filter branch Lekki' })
    ).toHaveAttribute('data-selected', 'true');
    expect(
      screen.getByRole('button', { name: 'Filter group Operations' })
    ).toHaveAttribute('data-selected', 'true');
  });

  it('does not persist locked branch scope into applied filter state', () => {
    const onApply = vi.fn();

    render(
      <ExpenseFiltersSheet
        branchScope={{ type: 'branch', branchId: 'branch-1' }}
        branches={branches}
        filters={DEFAULT_EXPENSE_FILTERS}
        groups={groups}
        onApply={onApply}
        onClose={vi.fn()}
        visible
      />
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Filter category Travel' })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Apply expense filters' })
    );

    expect(onApply).toHaveBeenCalledWith({
      ...DEFAULT_EXPENSE_FILTERS,
      category: 'Travel',
    });
  });

  it('displays a branch-scoped location as locked context instead of a conflicting selector', () => {
    render(
      <ExpenseFiltersSheet
        branchScope={{ type: 'branch', branchId: 'branch-1' }}
        branches={branches}
        filters={{ ...DEFAULT_EXPENSE_FILTERS, branchId: 'branch-2' }}
        groups={groups}
        onApply={vi.fn()}
        onClose={vi.fn()}
        visible
      />
    );

    expect(screen.getByText('Locked to Lekki')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Filter branch Ikeja' })
    ).not.toBeInTheDocument();
  });
});
