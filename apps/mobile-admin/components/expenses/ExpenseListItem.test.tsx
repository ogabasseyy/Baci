import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Expense } from '@/schemas/expense';
import { ExpenseListItem } from './ExpenseListItem';

const mocks = vi.hoisted(() => ({
  formatCurrency: vi.fn(
    (_amount: number, _locale?: string, _currency?: string) => 'NGN 12,500.00'
  ),
  router: { push: vi.fn() },
}));

vi.mock('expo-router', () => ({
  useRouter: () => mocks.router,
}));

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      border: '#334155',
      card: '#111827',
      primary: '#3b82f6',
      text: '#f8fafc',
      textMuted: '#94a3b8',
      textSecondary: '#cbd5e1',
    },
  }),
}));

vi.mock('@/lib/utils', () => ({
  formatCurrency: (amount: number, locale?: string, currency?: string) =>
    mocks.formatCurrency(amount, locale, currency),
}));

vi.mock('@react-native-vector-icons/ionicons', () => ({
  Ionicons: ({ name }: { name: string }) => <span data-icon={name} />,

  default: ({ name }: { name: string }) => <span data-icon={name} />,
  __esModule: true,
}));

vi.mock('react-native', () => ({
  StatusBar: () => null,
  Pressable: ({
    accessibilityLabel,
    accessibilityRole,
    children,
    onPress,
  }: {
    accessibilityLabel?: string;
    accessibilityRole?: string;
    children?: ReactNode;
    onPress?: () => void;
  }) => (
    <button
      aria-label={accessibilityLabel}
      onClick={() => onPress?.()}
      role={accessibilityRole}
      type="button"
    >
      {children}
    </button>
  ),
  StyleSheet: { create: (styles: Record<string, unknown>) => styles },
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

const expense = (overrides: Partial<Expense> = {}): Expense => ({
  amount: 12_500,
  branch_id: 'branch-1',
  category: 'Inventory',
  date: '2026-05-05T00:00:00.000Z',
  description: 'Office internet',
  created_by_user_id: null,
  group_id: null,
  id: 'expense-1',
  merchant_id: '00000000-0000-4000-8000-000000000001',
  payment_method: null,
  receipt_storage_path: null,
  receipt_url: null,
  reference: null,
  updated_at: '2026-05-05T00:00:00.000Z',
  updated_by_user_id: null,
  vendor_name: null,
  ...overrides,
});

describe('ExpenseListItem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.formatCurrency.mockReturnValue('NGN 12,500.00');
  });

  it('opens the expense detail screen when pressed', () => {
    render(
      <ExpenseListItem
        canEdit
        item={expense()}
        merchant={{ payout_currency: 'NGN' }}
      />
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Open expense Inventory: Office internet',
      })
    );

    expect(mocks.router.push).toHaveBeenCalledWith('/expenses/expense-1');
  });

  it('exposes an Edit shortcut that routes directly to the expense edit screen', () => {
    render(<ExpenseListItem canEdit item={expense()} />);

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Edit expense Inventory: Office internet (May 5, 2026, record expense-1)',
      })
    );

    expect(mocks.router.push).toHaveBeenCalledWith('/expenses/expense-1/edit');
    expect(
      screen.getByRole('button', {
        name: 'Open expense Inventory: Office internet',
      })
    ).toBeInTheDocument();
  });

  it('hides the Edit shortcut for view-only users while keeping detail navigation', () => {
    render(<ExpenseListItem canEdit={false} item={expense()} />);

    expect(
      screen.queryByRole('button', {
        name: 'Edit expense Inventory: Office internet (May 5, 2026, record expense-1)',
      })
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Open expense Inventory: Office internet',
      })
    );

    expect(mocks.router.push).toHaveBeenCalledWith('/expenses/expense-1');
  });

  it('uses a category-only Edit label when the expense has no description', () => {
    render(<ExpenseListItem canEdit item={expense({ description: null })} />);

    expect(
      screen.getByRole('button', {
        name: 'Edit expense Inventory (May 5, 2026, record expense-1)',
      })
    ).toBeInTheDocument();
  });

  it('gives duplicate-looking editable rows distinct, user-comprehensible Edit labels', () => {
    render(
      <>
        <ExpenseListItem canEdit item={expense({ id: 'expense-1' })} />
        <ExpenseListItem canEdit item={expense({ id: 'expense-2' })} />
      </>
    );

    expect(
      screen.getByRole('button', {
        name: 'Edit expense Inventory: Office internet (May 5, 2026, record expense-1)',
      })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'Edit expense Inventory: Office internet (May 5, 2026, record expense-2)',
      })
    ).toBeInTheDocument();
  });

  it('uses accessible labels with and without descriptions', () => {
    const { rerender } = render(<ExpenseListItem item={expense()} />);

    expect(
      screen.getByRole('button', {
        name: 'Open expense Inventory: Office internet',
      })
    ).toBeInTheDocument();

    rerender(<ExpenseListItem item={expense({ description: null })} />);

    expect(
      screen.getByRole('button', { name: 'Open expense Inventory' })
    ).toBeInTheDocument();
  });

  it('renders invalid dates explicitly', () => {
    render(<ExpenseListItem item={expense({ date: 'not-a-date' })} />);

    expect(screen.getByText('Invalid date')).toBeInTheDocument();
  });

  it('shows the receipt icon only when a receipt is attached', () => {
    const { rerender } = render(<ExpenseListItem item={expense()} />);

    expect(
      document.querySelector('[data-icon="document-attach-outline"]')
    ).not.toBeInTheDocument();

    rerender(
      <ExpenseListItem
        item={expense({ receipt_url: 'https://example.com/receipt.jpg' })}
      />
    );

    expect(
      document.querySelector('[data-icon="document-attach-outline"]')
    ).toBeInTheDocument();

    rerender(
      <ExpenseListItem
        item={expense({
          receipt_url: null,
          receipt_storage_path: 'merchant/expenses/receipt.jpg',
        })}
      />
    );

    expect(
      document.querySelector('[data-icon="document-attach-outline"]')
    ).toBeInTheDocument();
  });

  it('formats amounts with the merchant currency or NGN fallback', () => {
    const { rerender } = render(
      <ExpenseListItem item={expense()} merchant={{ payout_currency: 'USD' }} />
    );

    expect(mocks.formatCurrency).toHaveBeenLastCalledWith(
      12_500,
      undefined,
      'USD'
    );

    rerender(
      <ExpenseListItem item={expense()} merchant={{ payout_currency: null }} />
    );

    expect(mocks.formatCurrency).toHaveBeenLastCalledWith(
      12_500,
      undefined,
      'NGN'
    );
  });
});
