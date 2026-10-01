import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  detailExpenseFixture,
  detailExpenseId,
  getExpenseDetailMocks,
  resetExpenseDetailMocks,
} from '@/test/expenses/expense-detail.test-fixtures';

const { default: ExpenseDetailScreen } = await import('./[id]');
const mocks = getExpenseDetailMocks();

describe('ExpenseDetailScreen', () => {
  beforeEach(() => {
    resetExpenseDetailMocks();
  });

  it('selects and displays the expense branch', () => {
    render(<ExpenseDetailScreen />);

    expect(mocks.selectCalls[0]?.[0]).toContain('branch_id');
    expect(mocks.eqCalls).toContainEqual(['merchant_id', 'merchant-1']);
    expect(screen.getByText('Branch')).toBeInTheDocument();
    expect(screen.getByText('Lagos main')).toBeInTheDocument();
  });

  it('scopes branch detail lookups to the selected branch', () => {
    render(<ExpenseDetailScreen />);

    expect(mocks.queryOptions?.queryKey).toEqual([
      'expense',
      'merchant-1',
      'branch-1',
      detailExpenseId,
    ]);
    expect(mocks.queryOptions?.enabled).toBe(true);
    expect(mocks.eqCalls).toContainEqual(['branch_id', 'branch-1']);
  });

  it('uses maybeSingle so branch misses can render as not found', () => {
    render(<ExpenseDetailScreen />);

    expect(mocks.maybeSingleCalls).toBe(1);
    expect(mocks.singleCalls).toBe(0);
  });

  it.each([
    [
      'loading',
      { data: undefined, isLoading: true },
      'Loading expense details...',
    ],
    ['missing', { data: null, isLoading: false }, 'Expense not found.'],
    [
      'error',
      {
        data: undefined,
        error: new Error('Database error'),
        isError: true,
        isLoading: false,
      },
      'Could not load expense.',
    ],
  ])('shows the %s state from the expense query', (_state, queryState, message) => {
    mocks.queryState = queryState;

    render(<ExpenseDetailScreen />);

    expect(screen.getByText(message)).toBeInTheDocument();
  });

  it('resolves unavailable and historical branch labels', () => {
    mocks.expenseResult.data = { ...detailExpenseFixture(), branch_id: null };
    const { rerender } = render(<ExpenseDetailScreen />);
    expect(screen.getByText('Unassigned')).toBeInTheDocument();

    mocks.expenseResult.data = detailExpenseFixture();
    mocks.branches = [];
    mocks.branchesLoading = true;
    rerender(<ExpenseDetailScreen />);
    expect(screen.getByText('Loading branch...')).toBeInTheDocument();

    mocks.branchesLoading = false;
    mocks.historicalBranchResult = {
      data: { id: 'branch-1', name: 'Archived Lagos' },
      error: null,
    };
    rerender(<ExpenseDetailScreen />);
    expect(mocks.branchSelectCalls[0]?.[0]).toBe('id, name');
    expect(mocks.branchEqCalls).toEqual(
      expect.arrayContaining([
        ['id', 'branch-1'],
        ['merchant_id', 'merchant-1'],
      ])
    );
    expect(screen.getByText('Archived Lagos')).toBeInTheDocument();
  });

  it('shows Unknown branch when neither active nor historical metadata exists', () => {
    mocks.branches = [];
    mocks.historicalBranchResult = { data: null, error: null };

    render(<ExpenseDetailScreen />);

    expect(screen.getByText('Unknown branch')).toBeInTheDocument();
  });

  it('does not label a grouped expense Ungrouped while group metadata is loading or failed', () => {
    mocks.expenseResult.data = {
      ...detailExpenseFixture(),
      group_id: 'group-1',
    };
    mocks.groupsLoading = true;
    const { rerender } = render(<ExpenseDetailScreen />);
    expect(screen.getByText('Loading group...')).toBeInTheDocument();

    mocks.groupsLoading = false;
    mocks.groupsError = true;
    rerender(<ExpenseDetailScreen />);
    expect(screen.getByText('Group unavailable')).toBeInTheDocument();
  });

  it('shows the Edit header action only when canEdit is true', () => {
    const { unmount } = render(<ExpenseDetailScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit expense' }));
    expect(mocks.router.push).toHaveBeenCalledWith(
      `/expenses/${detailExpenseId}/edit`
    );
    unmount();
    mocks.canEdit = false;

    render(<ExpenseDetailScreen />);

    expect(screen.queryByRole('button', { name: 'Edit expense' })).toBeNull();
  });

  it('opens HTTP receipt links and rejects non-HTTP receipt links', async () => {
    mocks.expenseResult.data = {
      ...detailExpenseFixture(),
      receipt_url: 'https://example.com/receipt.jpg',
    };
    mocks.receiptUrl = 'https://example.com/receipt.jpg';
    const { rerender } = render(<ExpenseDetailScreen />);
    fireEvent.click(
      screen.getByRole('button', { name: 'View attached receipt' })
    );
    await waitFor(() => {
      expect(mocks.linking.openURL).toHaveBeenCalledWith(
        'https://example.com/receipt.jpg'
      );
    });

    mocks.expenseResult.data = {
      ...detailExpenseFixture(),
      receipt_url: 'javascript:alert(1)',
    };
    mocks.receiptUrl = 'javascript:alert(1)';
    rerender(<ExpenseDetailScreen />);
    fireEvent.click(
      screen.getByRole('button', { name: 'View attached receipt' })
    );
    await waitFor(() => {
      expect(mocks.linking.canOpenURL).toHaveBeenCalledTimes(1);
    });
    expect(mocks.linking.openURL).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['loading', true, true, null],
    ['denied', false, false, null],
    ['access error', false, false, new Error('Access unavailable')],
  ])('does not mount branch, group, receipt, or expense queries while access is %s', (_state, accessLoading, canView, accessError) => {
    mocks.accessLoading = accessLoading;
    mocks.canView = canView;
    mocks.accessError = accessError;

    render(<ExpenseDetailScreen />);

    expect(mocks.selectCalls).toHaveLength(0);
    expect(mocks.branchHookCalls).toBe(0);
    expect(mocks.groupHookCalls).toBe(0);
    expect(mocks.receiptHookCalls).toBe(0);
  });
});
