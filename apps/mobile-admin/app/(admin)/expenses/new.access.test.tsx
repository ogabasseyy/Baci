import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  alert: vi.fn(),
  branchCalls: 0,
  canCreate: true,
  error: null as Error | null,
  groupCalls: 0,
  isLoading: false,
  merchantCalls: 0,
  mutate: vi.fn(),
  router: { back: vi.fn() },
  saveCalls: 0,
}));

vi.mock('@/hooks/useExpenseAccess', () => ({
  useExpenseAccess: () => ({
    canCreate: mocks.canCreate,
    canEdit: false,
    error: mocks.error,
    isLoading: mocks.isLoading,
  }),
}));
vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      background: '#020617',
      border: '#334155',
      card: '#111827',
      primary: '#3b82f6',
      text: '#f8fafc',
      textOnPrimary: '#fff',
      textSecondary: '#cbd5e1',
    },
  }),
}));
vi.mock('@/hooks/useMerchant', () => ({
  useMerchant: () => {
    mocks.merchantCalls += 1;
    return { merchant: { id: '97e7a9a4-4f82-484d-a0a5-0f2ba07f4e2e' } };
  },
}));
vi.mock('@/hooks/useBranchScope', () => ({
  useBranchScope: () => {
    mocks.branchCalls += 1;
    return { scope: { type: 'all' } };
  },
}));
vi.mock('@/hooks/useBranches', () => ({
  useBranches: () => ({
    data: [
      {
        active: true,
        id: '8b3f1444-8890-4b6a-a00f-ae80949f05b2',
        is_default: true,
        name: 'Lagos main',
      },
    ],
    isLoading: false,
  }),
}));
vi.mock('@/hooks/useExpenseGroups', () => ({
  useExpenseGroups: () => {
    mocks.groupCalls += 1;
    return {
      activeGroups: [],
      allGroups: [],
      archiveGroup: vi.fn(),
      createGroup: vi.fn(),
      error: null,
      renameGroup: vi.fn(),
      refetch: vi.fn(),
    };
  },
}));
vi.mock('@tanstack/react-query', () => ({
  useMutation: () => ({ isPending: false, mutate: vi.fn() }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/hooks/useSaveExpense', () => ({
  useSaveExpense: () => {
    mocks.saveCalls += 1;
    return { isPending: false, mutate: mocks.mutate };
  },
}));
vi.mock('@/components/ui/AppFormScreen', () => ({
  AppFormScreen: ({
    children,
    footer,
  }: {
    children?: ReactNode;
    footer?: ReactNode;
  }) => (
    <section aria-label="expense form">
      {children}
      {footer}
    </section>
  ),
}));
vi.mock('@/components/expenses/ExpenseFormFields', () => ({
  ExpenseFormFields: ({
    amount,
    onAmountChange,
  }: {
    amount: string;
    onAmountChange: (value: string) => void;
  }) => (
    <input
      aria-label="Expense amount"
      onChange={(event) => onAmountChange(event.target.value)}
      value={amount}
    />
  ),
}));
vi.mock('@/components/expenses/ExpenseCategorySheet', () => ({
  ExpenseCategorySheet: () => null,
}));
vi.mock('@/components/expenses/ExpenseGroupManagerSheet', () => ({
  ExpenseGroupManagerSheet: () => null,
}));
vi.mock('expo-image-picker', () => ({ launchImageLibraryAsync: vi.fn() }));
vi.mock('expo-router', () => ({
  Stack: {
    Screen: ({ options }: { options?: { headerLeft?: () => ReactNode } }) => (
      <>{options?.headerLeft?.()}</>
    ),
  },
  useNavigation: () => ({ dispatch: vi.fn() }),
  useRouter: () => mocks.router,
}));
vi.mock('expo-router/react-navigation', () => ({
  usePreventRemove: vi.fn(),
}));
vi.mock('@react-native-vector-icons/ionicons', () => ({ default: () => null }));
vi.mock('react-native', () => ({
  ActivityIndicator: () => null,
  Alert: { alert: mocks.alert },
  Pressable: ({
    accessibilityLabel,
    children,
    disabled,
    onPress,
  }: {
    accessibilityLabel?: string;
    children?: ReactNode;
    disabled?: boolean;
    onPress?: () => void;
  }) => (
    <button
      aria-label={accessibilityLabel}
      disabled={disabled}
      onClick={onPress}
      type="button"
    >
      {children}
    </button>
  ),
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  StyleSheet: { create: (value: unknown) => value },
}));

import AddExpenseScreen from './new';

describe('AddExpenseScreen access boundary', () => {
  beforeEach(() => {
    mocks.branchCalls = 0;
    mocks.alert.mockReset();
    mocks.canCreate = true;
    mocks.error = null;
    mocks.groupCalls = 0;
    mocks.isLoading = false;
    mocks.merchantCalls = 0;
    mocks.mutate.mockReset();
    mocks.saveCalls = 0;
  });

  it.each([
    ['loading', true, true, null],
    ['denied', false, false, null],
    ['access error', false, false, new Error('Access unavailable')],
  ])('does not mount create data or save hooks while access is %s', (_state, isLoading, canCreate, error) => {
    mocks.isLoading = isLoading;
    mocks.canCreate = canCreate;
    mocks.error = error;

    render(<AddExpenseScreen />);

    expect(screen.queryByRole('region', { name: 'expense form' })).toBeNull();
    expect(mocks.merchantCalls).toBe(0);
    expect(mocks.branchCalls).toBe(0);
    expect(mocks.groupCalls).toBe(0);
    expect(mocks.saveCalls).toBe(0);
  });

  it('does not mutate invalid create values', () => {
    render(<AddExpenseScreen />);

    fireEvent.click(screen.getByRole('button', { name: 'Save expense' }));

    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it('preserves a trailing decimal while entering an amount', () => {
    render(<AddExpenseScreen />);

    const amount = screen.getByLabelText('Expense amount');
    fireEvent.change(amount, { target: { value: '12.' } });

    expect(amount).toHaveValue('12.');
  });

  it('confirms before closing a dirty create draft', () => {
    render(<AddExpenseScreen />);
    fireEvent.change(screen.getByLabelText('Expense amount'), {
      target: { value: '1' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Close add expense screen' })
    );
    expect(mocks.alert).toHaveBeenCalledWith(
      'Discard changes?',
      'Your unsaved changes will be lost.',
      expect.any(Array)
    );
    expect(mocks.router.back).not.toHaveBeenCalled();
  });
});
