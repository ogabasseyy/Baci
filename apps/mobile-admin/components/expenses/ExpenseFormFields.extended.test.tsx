import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ExpenseFormFields } from './ExpenseFormFields';

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      border: '#d1d5db',
      card: '#f8fafc',
      error: '#ef4444',
      primary: '#2563eb',
      text: '#111827',
      textMuted: '#9ca3af',
      textSecondary: '#6b7280',
    },
  }),
}));
vi.mock('@/hooks/useCurrency', () => ({
  useCurrency: () => ({
    currency: 'USD',
    format: (amount: number) => `$${amount.toFixed(2)}`,
    formatCompact: (amount: number) => `$${amount}`,
    symbol: '$',
  }),
}));
vi.mock('@/components/ui/AppDatePickerField', () => ({
  AppDatePickerField: () => null,
}));
vi.mock('@/components/ui/SafeImage', () => ({
  default: ({ source }: { source?: { uri?: string } }) => (
    <img alt="Receipt preview" data-src={source?.uri} />
  ),
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
    accessibilityState,
    children,
    disabled,
    onPress,
  }: {
    accessibilityLabel?: string;
    accessibilityRole?: string;
    accessibilityState?: { checked?: boolean; disabled?: boolean };
    children?: ReactNode;
    disabled?: boolean;
    onPress?: () => void;
  }) => (
    <button
      aria-label={accessibilityLabel}
      disabled={disabled}
      onClick={onPress}
      {...(accessibilityRole === 'radio'
        ? {
            'aria-checked': accessibilityState?.checked ?? false,
            role: 'radio',
          }
        : { role: accessibilityRole })}
      type="button"
    >
      {children}
    </button>
  ),
  StyleSheet: { create: (styles: Record<string, unknown>) => styles },
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  TextInput: ({
    accessibilityLabel,
    onChangeText,
    placeholder,
    value,
  }: {
    accessibilityLabel?: string;
    onChangeText?: (value: string) => void;
    placeholder?: string;
    value?: string;
  }) => (
    <input
      aria-label={accessibilityLabel}
      onChange={(event) => onChangeText?.(event.target.value)}
      placeholder={placeholder}
      value={value ?? ''}
    />
  ),
  View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

const activeGroups = [
  {
    archived_at: null,
    created_at: '2026-08-09T12:00:00.000Z',
    id: '02f07db2-10e9-4c60-a0df-a4f5ccba9d9d',
    merchant_id: '97e7a9a4-4f82-484d-a0a5-0f2ba07f4e2e',
    name: 'Operations',
    updated_at: '2026-08-09T12:00:00.000Z',
  },
];
const branches = [
  { id: 'branch-1', name: 'Lagos main' },
  { id: 'branch-2', name: 'Lekki branch' },
];

describe('ExpenseFormFields expanded controls', () => {
  it('composes editable date and metadata controls for an expanded expense draft', () => {
    render(
      <ExpenseFormFields
        activeGroups={activeGroups}
        amount="12500"
        branches={branches}
        canEditGroups
        date="2027-01-15"
        description="Office internet"
        onAmountChange={vi.fn()}
        onBranchChange={vi.fn()}
        onDateChange={vi.fn()}
        onDescriptionChange={vi.fn()}
        onGroupChange={vi.fn()}
        onManageGroups={vi.fn()}
        onOpenCategorySheet={vi.fn()}
        onPaymentMethodChange={vi.fn()}
        onReceiptPress={vi.fn()}
        onReferenceChange={vi.fn()}
        onVendorNameChange={vi.fn()}
        paymentMethod="Transfer"
        receiptUri={null}
        reference="INV-101"
        selectedBranchId="branch-1"
        selectedCategory="Utilities"
        selectedGroupId={null}
        vendorName="ISP Ltd"
      />
    );

    expect(
      screen.getByRole('button', { name: 'Select expense date' })
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Expense vendor or payee')).toHaveValue(
      'ISP Ltd'
    );
    expect(screen.getByLabelText('Expense payment method')).toHaveValue(
      'Transfer'
    );
    expect(screen.getByLabelText('Expense reference')).toHaveValue('INV-101');
    expect(screen.getByText('Lagos main')).toBeInTheDocument();
    expect(screen.getByText('Operations')).toBeInTheDocument();
  });

  it('forwards receipt restoration without reopening the file picker', () => {
    const onReceiptPress = vi.fn();
    const onReceiptRestore = vi.fn();
    render(
      <ExpenseFormFields
        amount=""
        description=""
        existingReceiptUri="https://example.com/receipts/existing.jpg"
        onAmountChange={vi.fn()}
        onDescriptionChange={vi.fn()}
        onOpenCategorySheet={vi.fn()}
        onReceiptPress={onReceiptPress}
        onReceiptRestore={onReceiptRestore}
        receiptChange={{ kind: 'remove' }}
        receiptUri={null}
        selectedCategory="Inventory"
      />
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Restore expense receipt' })
    );
    expect(onReceiptRestore).toHaveBeenCalledOnce();
    expect(onReceiptPress).not.toHaveBeenCalled();
  });

  it('propagates the form disabled state to branch and group controls', () => {
    const onBranchChange = vi.fn();
    const onGroupChange = vi.fn();
    const onManageGroups = vi.fn();
    render(
      <ExpenseFormFields
        activeGroups={activeGroups}
        amount=""
        branches={branches}
        canEditGroups
        description=""
        disabled
        onAmountChange={vi.fn()}
        onBranchChange={onBranchChange}
        onDescriptionChange={vi.fn()}
        onGroupChange={onGroupChange}
        onManageGroups={onManageGroups}
        onOpenCategorySheet={vi.fn()}
        onReceiptPress={vi.fn()}
        receiptUri={null}
        selectedBranchId="branch-1"
        selectedCategory="Inventory"
        selectedGroupId={null}
      />
    );

    const branch = screen.getByRole('radio', {
      name: 'Assign expense to Lekki branch',
    });
    const group = screen.getByRole('radio', {
      name: 'Assign expense to Operations group',
    });
    const manage = screen.getByRole('button', {
      name: 'Manage expense groups',
    });
    expect(branch).toBeDisabled();
    expect(group).toBeDisabled();
    expect(manage).toBeDisabled();
    fireEvent.click(branch);
    fireEvent.click(group);
    fireEvent.click(manage);
    expect(onBranchChange).not.toHaveBeenCalled();
    expect(onGroupChange).not.toHaveBeenCalled();
    expect(onManageGroups).not.toHaveBeenCalled();
  });
});
