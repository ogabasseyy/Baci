import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExpenseCoreFields } from './ExpenseCoreFields';

const mocks = vi.hoisted(() => ({
  datePickerProps: {
    maximumDate: undefined as Date | undefined,
    onConfirm: ((_date: Date) => undefined) as (date: Date) => void,
  },
}));

vi.mock('@/components/ui/AppDatePickerField', () => ({
  AppDatePickerField: ({
    maximumDate,
    onConfirm,
  }: {
    maximumDate?: Date;
    onConfirm: (date: Date) => void;
  }) => {
    mocks.datePickerProps.maximumDate = maximumDate;
    mocks.datePickerProps.onConfirm = onConfirm;
    return <button aria-label="Choose date from picker" type="button" />;
  },
}));

vi.mock('@/hooks/useCurrency', () => ({
  useCurrency: () => ({ symbol: '₦' }),
}));

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      border: '#d1d5db',
      card: '#f8fafc',
      error: '#ef4444',
      text: '#111827',
      textMuted: '#9ca3af',
      textSecondary: '#6b7280',
    },
  }),
}));

vi.mock('@react-native-vector-icons/ionicons', () => ({
  Ionicons: () => null,
  default: () => null,
  __esModule: true,
}));

vi.mock('react-native', () => ({
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
    accessibilityState?: { expanded?: boolean };
    children?: ReactNode;
    disabled?: boolean;
    onPress?: () => void;
  }) => (
    <button
      aria-expanded={accessibilityState?.expanded}
      aria-label={accessibilityLabel}
      disabled={disabled}
      onClick={onPress}
      role={accessibilityRole}
      type="button"
    >
      {children}
    </button>
  ),
  StyleSheet: { create: (styles: Record<string, unknown>) => styles },
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  TextInput: ({
    accessibilityLabel,
    editable,
    maxLength,
    onChangeText,
    value,
  }: {
    accessibilityLabel?: string;
    editable?: boolean;
    maxLength?: number;
    onChangeText?: (value: string) => void;
    value?: string;
  }) => (
    <input
      aria-label={accessibilityLabel}
      disabled={editable === false}
      maxLength={maxLength}
      onChange={(event) => onChangeText?.(event.target.value)}
      value={value ?? ''}
    />
  ),
  View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

describe('ExpenseCoreFields', () => {
  beforeEach(() => {
    mocks.datePickerProps.maximumDate = undefined;
    mocks.datePickerProps.onConfirm = () => undefined;
  });

  it('normalizes currency formatting before forwarding an amount edit', () => {
    const onAmountChange = vi.fn();

    render(
      <ExpenseCoreFields
        amount="12500.5"
        date="2026-08-09"
        description=""
        onAmountChange={onAmountChange}
        onDateChange={vi.fn()}
        onDescriptionChange={vi.fn()}
        onOpenCategorySheet={vi.fn()}
        selectedCategory="Inventory"
      />
    );

    expect(screen.getByLabelText('Expense amount')).toHaveValue('12,500.5');

    fireEvent.change(screen.getByLabelText('Expense amount'), {
      target: { value: '₦ 4,321.75' },
    });

    expect(onAmountChange).toHaveBeenCalledWith('4321.75');
  });

  it('rejects malformed amount text instead of rewriting it', () => {
    const onAmountChange = vi.fn();

    render(
      <ExpenseCoreFields
        amount="100"
        date="2026-08-09"
        description=""
        onAmountChange={onAmountChange}
        onDateChange={vi.fn()}
        onDescriptionChange={vi.fn()}
        onOpenCategorySheet={vi.fn()}
        selectedCategory="Inventory"
      />
    );

    fireEvent.change(screen.getByLabelText('Expense amount'), {
      target: { value: '1e3' },
    });
    fireEvent.change(screen.getByLabelText('Expense amount'), {
      target: { value: '12a3' },
    });

    expect(onAmountChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Expense amount')).toHaveValue('100');
  });

  it('stores a selected future date as a local YYYY-MM-DD value without a maximum bound', () => {
    const onDateChange = vi.fn();

    render(
      <ExpenseCoreFields
        amount=""
        date="2026-08-09"
        description=""
        onAmountChange={vi.fn()}
        onDateChange={onDateChange}
        onDescriptionChange={vi.fn()}
        onOpenCategorySheet={vi.fn()}
        selectedCategory="Inventory"
      />
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Select expense date' })
    );
    mocks.datePickerProps.onConfirm(new Date(2027, 0, 15));

    expect(mocks.datePickerProps.maximumDate).toBeUndefined();
    expect(onDateChange).toHaveBeenCalledWith('2027-01-15');
  });

  it('forwards category and description edits through accessible controls', () => {
    const onDescriptionChange = vi.fn();
    const onOpenCategorySheet = vi.fn();

    render(
      <ExpenseCoreFields
        amount=""
        date="2026-08-09"
        description="Old note"
        onAmountChange={vi.fn()}
        onDateChange={vi.fn()}
        onDescriptionChange={onDescriptionChange}
        onOpenCategorySheet={onOpenCategorySheet}
        selectedCategory="Utilities"
      />
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Select expense category' })
    );
    fireEvent.change(screen.getByLabelText('Expense description'), {
      target: { value: 'Internet subscription' },
    });

    expect(onOpenCategorySheet).toHaveBeenCalledOnce();
    expect(onDescriptionChange).toHaveBeenCalledWith('Internet subscription');
  });

  it('marks form controls unavailable when the form is disabled', () => {
    render(
      <ExpenseCoreFields
        amount=""
        date="2026-08-09"
        description=""
        disabled
        onAmountChange={vi.fn()}
        onDateChange={vi.fn()}
        onDescriptionChange={vi.fn()}
        onOpenCategorySheet={vi.fn()}
        selectedCategory="Inventory"
      />
    );

    expect(screen.getByLabelText('Expense amount')).toBeDisabled();
    expect(screen.getByLabelText('Expense description')).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Select expense date' })
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Select expense category' })
    ).toBeDisabled();
  });
});
