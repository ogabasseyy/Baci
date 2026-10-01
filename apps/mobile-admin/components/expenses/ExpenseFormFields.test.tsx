import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ExpenseFormFields } from './ExpenseFormFields';

type ExpenseFormFieldsProps = ComponentProps<typeof ExpenseFormFields>;

const defaultProps: ExpenseFormFieldsProps = {
  amount: '',
  description: '',
  onAmountChange: vi.fn(),
  onDescriptionChange: vi.fn(),
  onOpenCategorySheet: vi.fn(),
  onReceiptPress: vi.fn(),
  receiptUri: null,
  selectedCategory: 'Inventory',
};

function renderExpenseFormFields(
  overrides: Partial<ExpenseFormFieldsProps> = {}
) {
  return render(<ExpenseFormFields {...defaultProps} {...overrides} />);
}

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
  Ionicons: ({ name }: { name: string }) => (
    <span aria-hidden="true" data-icon={name} />
  ),

  default: ({ name }: { name: string }) => (
    <span aria-hidden="true" data-icon={name} />
  ),
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
  StyleSheet: {
    create: (styles: Record<string, unknown>) => styles,
  },
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

describe('ExpenseFormFields', () => {
  it('forwards amount, description, category, and receipt actions', () => {
    const onAmountChange = vi.fn();
    const onDescriptionChange = vi.fn();
    const onOpenCategorySheet = vi.fn();
    const onReceiptPress = vi.fn();

    renderExpenseFormFields({
      amount: '12500',
      description: 'Office internet',
      onAmountChange,
      onDescriptionChange,
      onOpenCategorySheet,
      onReceiptPress,
      selectedCategory: 'Marketing',
    });

    const amountInput = screen.getByLabelText('Expense amount');

    expect(screen.getByText('$')).toBeInTheDocument();
    expect(amountInput).toBeInTheDocument();
    expect((amountInput as HTMLInputElement).value.replace(/\D/g, '')).toBe(
      '12500'
    );
    expect(screen.getByDisplayValue('Office internet')).toBeInTheDocument();
    expect(screen.getByText('Marketing')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Expense amount'), {
      target: { value: '45000' },
    });
    fireEvent.change(screen.getByLabelText('Expense description'), {
      target: { value: 'Updated note' },
    });
    fireEvent.click(screen.getByLabelText('Select expense category'));
    fireEvent.click(screen.getByLabelText('Add expense receipt'));

    expect(onAmountChange).toHaveBeenCalledWith('45000');
    expect(onDescriptionChange).toHaveBeenCalledWith('Updated note');
    expect(onOpenCategorySheet).toHaveBeenCalledTimes(1);
    expect(onReceiptPress).toHaveBeenCalledTimes(1);
  });

  it('shows the receipt preview state when a receipt is selected', () => {
    renderExpenseFormFields({ receiptUri: 'file:///receipt.jpg' });

    expect(
      screen.getByRole('img', { name: 'Receipt preview' })
    ).toHaveAttribute('data-src', 'file:///receipt.jpg');
    expect(screen.getByText('Replace')).toBeInTheDocument();
  });

  it('shows the category placeholder and labeled controls when no category is selected', () => {
    renderExpenseFormFields({ selectedCategory: null });

    expect(screen.getByText('Select a category')).toBeInTheDocument();
    expect(screen.getByLabelText('Expense amount')).toBeInTheDocument();
    expect(screen.getByLabelText('Expense description')).toBeInTheDocument();
    expect(
      screen.getByLabelText('Select expense category')
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Add expense receipt')).toBeInTheDocument();
  });

  it('keeps the category control accessible when the selected category is empty', () => {
    renderExpenseFormFields({ selectedCategory: '' });

    expect(screen.getByText('Select a category')).toBeInTheDocument();
    expect(
      screen.getByLabelText('Select expense category')
    ).toBeInTheDocument();
  });
});
