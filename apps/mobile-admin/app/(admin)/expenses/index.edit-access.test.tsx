import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  access: {
    canCreate: true,
    canEdit: true,
    canView: true,
    error: null as Error | null,
    isLoading: false,
  },
}));

vi.mock('@/hooks/useExpenseAccess', () => ({
  useExpenseAccess: () => mocks.access,
}));
vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ colors: {} }),
}));
vi.mock('@/components/expenses/ExpenseListContent', () => ({
  ExpenseListContent: ({ canEdit }: { canEdit: boolean }) => (
    <span>{canEdit ? 'editable expense list' : 'view-only expense list'}</span>
  ),
}));
vi.mock('@/components/expenses/ExpenseStatusShell', () => ({
  ExpenseStatusShell: () => <span>status shell</span>,
}));
vi.mock('@/components/ui/ScreenSkeleton', () => ({
  ScreenSkeleton: () => <span>loading</span>,
}));

import ExpensesScreen from './index';

describe('ExpensesScreen edit access', () => {
  beforeEach(() => {
    mocks.access = {
      canCreate: true,
      canEdit: true,
      canView: true,
      error: null,
      isLoading: false,
    };
  });

  it('forwards edit access to the expense list', () => {
    const { rerender } = render(<ExpensesScreen />);

    expect(screen.getByText('editable expense list')).toBeInTheDocument();

    mocks.access = { ...mocks.access, canEdit: false };
    rerender(<ExpensesScreen />);

    expect(screen.getByText('view-only expense list')).toBeInTheDocument();
    expect(screen.queryByText('editable expense list')).not.toBeInTheDocument();
  });
});
