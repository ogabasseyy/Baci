import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExpenseDetail } from '@/schemas/expense-detail';

const merchantId = '97e7a9a4-4f82-484d-a0a5-0f2ba07f4e2e';
const expenseId = '6d89c8af-7bef-4b78-a7b5-9c2a63f691e9';
const branchId = '8b3f1444-8890-4b6a-a00f-ae80949f05b2';

const expense: ExpenseDetail = {
  amount: 4250,
  branch_id: branchId,
  category: 'Utilities',
  created_by_user_id: null,
  date: '2026-08-08',
  description: 'Internet subscription',
  group_id: null,
  id: expenseId,
  merchant_id: merchantId,
  payment_method: 'Transfer',
  receipt_storage_path: null,
  receipt_url: null,
  reference: 'INV-101',
  updated_at: '2026-08-08T12:00:00.000Z',
  updated_by_user_id: null,
  vendor_name: 'ISP Ltd',
};

const mocks = vi.hoisted(() => ({
  accessError: null as Error | null,
  accessLoading: false,
  branchCalls: 0,
  canEdit: true,
  editFormCalls: 0,
  eqCalls: [] as unknown[][],
  expense: null as ExpenseDetail | null,
  from: vi.fn(),
  groupCalls: 0,
  merchantCalls: 0,
  queryCalls: 0,
  queryState: null as {
    data?: ExpenseDetail | null;
    error?: Error;
    isError?: boolean;
    isLoading: boolean;
  } | null,
  receiptCalls: 0,
  routeId: '6d89c8af-7bef-4b78-a7b5-9c2a63f691e9',
  selectCalls: [] as unknown[][],
}));

function expenseQuery() {
  const chain: Record<string, unknown> = {};
  chain.select = (...args: unknown[]) => {
    mocks.selectCalls.push(args);
    return chain;
  };
  chain.eq = (...args: unknown[]) => {
    mocks.eqCalls.push(args);
    return chain;
  };
  chain.maybeSingle = () =>
    Promise.resolve({ data: mocks.expense, error: null });
  return chain;
}

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({
    enabled,
    queryFn,
  }: {
    enabled?: boolean;
    queryFn: () => Promise<unknown>;
  }) => {
    mocks.queryCalls += 1;
    if (enabled) void queryFn();
    return (
      mocks.queryState ?? {
        data: enabled ? mocks.expense : undefined,
        error: null,
        isError: false,
        isLoading: false,
        refetch: vi.fn(),
      }
    );
  },
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('@/lib/supabase', () => ({ supabase: { from: mocks.from } }));
vi.mock('@/hooks/useExpenseAccess', () => ({
  useExpenseAccess: () => ({
    canEdit: mocks.canEdit,
    error: mocks.accessError,
    isLoading: mocks.accessLoading,
    isRefreshing: false,
  }),
}));
vi.mock('@/hooks/useMerchant', () => ({
  useMerchant: () => {
    mocks.merchantCalls += 1;
    return { merchant: { id: merchantId } };
  },
}));
vi.mock('@/hooks/useBranchScope', () => ({
  useBranchScope: () => {
    mocks.branchCalls += 1;
    return { scope: { type: 'branch', branchId } };
  },
}));
vi.mock('@/hooks/useExpenseGroups', () => ({
  useExpenseGroups: () => {
    mocks.groupCalls += 1;
    return { error: null, refetch: vi.fn() };
  },
}));
vi.mock('@/hooks/useExpenseReceiptUrl', () => ({
  useExpenseReceiptUrl: () => {
    mocks.receiptCalls += 1;
    return {};
  },
}));
vi.mock('@/components/expenses/ExpenseEditForm', () => ({
  ExpenseEditForm: ({ expense: formExpense }: { expense: ExpenseDetail }) => {
    mocks.editFormCalls += 1;
    return <output aria-label="authorized edit form">{formExpense.id}</output>;
  },
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
vi.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: mocks.routeId }),
}));
vi.mock('@react-native-vector-icons/ionicons', () => ({ default: () => null }));
vi.mock('react-native', () => ({
  StyleSheet: { create: (value: unknown) => value },
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

import EditExpenseScreen from './edit';

describe('EditExpenseScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.accessError = null;
    mocks.accessLoading = false;
    mocks.branchCalls = 0;
    mocks.canEdit = true;
    mocks.editFormCalls = 0;
    mocks.eqCalls.length = 0;
    mocks.expense = { ...expense };
    mocks.from.mockImplementation(expenseQuery);
    mocks.groupCalls = 0;
    mocks.merchantCalls = 0;
    mocks.queryCalls = 0;
    mocks.queryState = null;
    mocks.receiptCalls = 0;
    mocks.routeId = expenseId;
    mocks.selectCalls.length = 0;
  });

  it('selects the exact scoped row before mounting the authorized edit form', () => {
    render(<EditExpenseScreen />);

    expect(mocks.selectCalls[0]?.[0]).toBe(
      'id, merchant_id, amount, category, description, date, receipt_url, receipt_storage_path, branch_id, group_id, vendor_name, payment_method, reference, created_by_user_id, updated_by_user_id, updated_at'
    );
    expect(mocks.eqCalls).toEqual(
      expect.arrayContaining([
        ['id', expenseId],
        ['merchant_id', merchantId],
        ['branch_id', branchId],
      ])
    );
    expect(screen.getByLabelText('authorized edit form')).toHaveTextContent(
      expenseId
    );
  });

  it.each([
    ['loading', true, true, null],
    ['denied', false, false, null],
    ['access error', false, false, new Error('Access unavailable')],
    ['malformed route', false, true, null],
  ])('does not mount merchant, branch, group, receipt, or expense hooks while %s', (_state, isLoading, canEdit, error) => {
    mocks.accessLoading = isLoading;
    mocks.canEdit = canEdit;
    mocks.accessError = error;
    if (_state === 'malformed route') mocks.routeId = 'not-an-expense-id';

    render(<EditExpenseScreen />);

    expect(mocks.merchantCalls).toBe(0);
    expect(mocks.branchCalls).toBe(0);
    expect(mocks.groupCalls).toBe(0);
    expect(mocks.queryCalls).toBe(0);
    expect(mocks.receiptCalls).toBe(0);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.editFormCalls).toBe(0);
  });

  it.each([
    ['loading', { isLoading: true }, 'Loading expense details...'],
    [
      'error',
      {
        error: new Error('Database unavailable'),
        isError: true,
        isLoading: false,
      },
      'Could not load expense.',
    ],
    ['not found', { data: null, isLoading: false }, 'Expense not found.'],
  ])('renders the queried %s state without mounting the form', (_state, queryState, message) => {
    mocks.queryState = queryState;

    render(<EditExpenseScreen />);

    expect(screen.getByText(message)).toBeInTheDocument();
    expect(mocks.editFormCalls).toBe(0);
  });
});
