import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExpenseDetails } from './ExpenseDetails';
import type { ExpenseDetail, ExpenseDetailColors } from './types';

const mocks = vi.hoisted(() => ({
  alert: vi.fn(),
  linking: {
    canOpenURL: vi.fn(() => Promise.resolve(true)),
    openURL: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock('@react-native-vector-icons/ionicons', () => ({
  Ionicons: ({ name }: { name: string }) => <span data-icon={name} />,

  default: ({ name }: { name: string }) => <span data-icon={name} />,
  __esModule: true,
}));

vi.mock('react-native', () => ({
  StatusBar: () => null,
  Alert: { alert: mocks.alert },
  Linking: mocks.linking,
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
  ScrollView: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  StyleSheet: {
    create: (styles: Record<string, unknown>) => styles,
    hairlineWidth: 1,
  },
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

const colors: ExpenseDetailColors = {
  background: '#020617',
  card: '#111827',
  border: '#334155',
  primary: '#3b82f6',
  text: '#f8fafc',
  textSecondary: '#cbd5e1',
};

const expense = (overrides: Partial<ExpenseDetail> = {}): ExpenseDetail => ({
  amount: 12_500,
  branch_id: 'branch-1',
  category: 'Inventory',
  created_by_user_id: null,
  date: '2026-05-05T00:00:00.000Z',
  description: 'Office internet',
  group_id: null,
  id: 'expense-1',
  merchant_id: '97e7a9a4-4f82-484d-a0a5-0f2ba07f4e2e',
  payment_method: null,
  receipt_storage_path: null,
  receipt_url: null,
  reference: 'EXP-1',
  updated_at: '2026-05-05T00:00:00.000Z',
  updated_by_user_id: null,
  vendor_name: null,
  ...overrides,
});

describe('ExpenseDetails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.linking.canOpenURL.mockResolvedValue(true);
    mocks.linking.openURL.mockResolvedValue(undefined);
  });

  it('renders the formatted amount, metadata, and branch name', () => {
    render(
      <ExpenseDetails
        expense={expense()}
        branchName="Lagos main"
        colors={colors}
        formattedAmount="NGN12,500.00"
        groupName="Ungrouped"
        receiptUrl={null}
        cardShadow={{}}
      />
    );

    expect(screen.getByText('NGN12,500.00')).toBeInTheDocument();
    expect(screen.getByText('Inventory')).toBeInTheDocument();
    expect(screen.getByText('May 5, 2026')).toBeInTheDocument();
    expect(screen.getByText('Lagos main')).toBeInTheDocument();
  });

  it('shows invalid date text for malformed dates', () => {
    render(
      <ExpenseDetails
        expense={expense({ date: 'not-a-date' })}
        branchName="Lagos main"
        colors={colors}
        formattedAmount="NGN12,500.00"
        groupName="Ungrouped"
        receiptUrl={null}
        cardShadow={{}}
      />
    );

    expect(screen.getByText('Invalid date')).toBeInTheDocument();
  });

  it('renders metadata values and explicit None and Ungrouped fallbacks', () => {
    const { rerender } = render(
      <ExpenseDetails
        branchName="Lagos main"
        cardShadow={{}}
        colors={colors}
        expense={expense({
          payment_method: 'Transfer',
          reference: 'INV-9',
          vendor_name: 'ISP Ltd',
        })}
        formattedAmount="NGN12,500.00"
        groupName="Marketing"
        receiptUrl={null}
      />
    );
    expect(screen.getByText('ISP Ltd')).toBeInTheDocument();
    expect(screen.getByText('Transfer')).toBeInTheDocument();
    expect(screen.getByText('INV-9')).toBeInTheDocument();
    expect(screen.getByText('Marketing')).toBeInTheDocument();
    rerender(
      <ExpenseDetails
        branchName="Lagos main"
        cardShadow={{}}
        colors={colors}
        expense={expense({ reference: null })}
        formattedAmount="NGN12,500.00"
        groupName="Ungrouped"
        receiptUrl={null}
      />
    );
    expect(screen.getAllByText('None')).toHaveLength(3);
    expect(screen.getByText('Ungrouped')).toBeInTheDocument();
  });

  it('opens valid receipt links from the receipt action', async () => {
    render(
      <ExpenseDetails
        expense={expense({ receipt_url: 'https://example.com/receipt.jpg' })}
        branchName="Lagos main"
        colors={colors}
        formattedAmount="NGN12,500.00"
        groupName="Ungrouped"
        receiptUrl="https://example.com/receipt.jpg"
        cardShadow={{}}
      />
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'View attached receipt' })
    );

    expect(mocks.linking.canOpenURL).toHaveBeenCalledWith(
      'https://example.com/receipt.jpg'
    );
    await waitFor(() => {
      expect(mocks.linking.openURL).toHaveBeenCalledWith(
        'https://example.com/receipt.jpg'
      );
    });
  });

  it('shows an alert when receipt links cannot be opened', async () => {
    mocks.linking.canOpenURL.mockResolvedValue(false);

    render(
      <ExpenseDetails
        expense={expense({ receipt_url: 'https://example.com/receipt.jpg' })}
        branchName="Lagos main"
        colors={colors}
        formattedAmount="NGN12,500.00"
        groupName="Ungrouped"
        receiptUrl="https://example.com/receipt.jpg"
        cardShadow={{}}
      />
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'View attached receipt' })
    );

    await waitFor(() => {
      expect(mocks.alert).toHaveBeenCalledWith(
        'Receipt unavailable',
        'This receipt link cannot be opened.'
      );
    });
    expect(mocks.linking.openURL).not.toHaveBeenCalled();
  });

  it('surfaces private receipt loading and failure states', () => {
    const { rerender } = render(
      <ExpenseDetails
        branchName="Lagos main"
        colors={colors}
        expense={expense({
          receipt_storage_path: 'merchant/expenses/receipt.jpg',
        })}
        formattedAmount="NGN12,500.00"
        groupName="Ungrouped"
        receiptLoading
        receiptUrl={null}
      />
    );
    expect(screen.getByText('Loading receipt…')).toBeInTheDocument();

    rerender(
      <ExpenseDetails
        branchName="Lagos main"
        colors={colors}
        expense={expense({
          receipt_storage_path: 'merchant/expenses/receipt.jpg',
        })}
        formattedAmount="NGN12,500.00"
        groupName="Ungrouped"
        receiptError={new Error('signing failed')}
        receiptUrl={null}
      />
    );
    expect(
      screen.getByText('Receipt unavailable. Try again.')
    ).toBeInTheDocument();
  });
});
