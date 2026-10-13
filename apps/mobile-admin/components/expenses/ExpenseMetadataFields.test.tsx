import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ExpenseMetadataFields } from './ExpenseMetadataFields';

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      border: '#d1d5db',
      card: '#f8fafc',
      text: '#111827',
      textMuted: '#9ca3af',
      textSecondary: '#6b7280',
    },
  }),
}));

vi.mock('react-native', () => ({
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

describe('ExpenseMetadataFields', () => {
  it('forwards optional vendor, free-text payment method, and reference values', () => {
    const onPaymentMethodChange = vi.fn();
    const onReferenceChange = vi.fn();
    const onVendorNameChange = vi.fn();

    render(
      <ExpenseMetadataFields
        onPaymentMethodChange={onPaymentMethodChange}
        onReferenceChange={onReferenceChange}
        onVendorNameChange={onVendorNameChange}
        paymentMethod=""
        reference=""
        vendorName=""
      />
    );

    fireEvent.change(screen.getByLabelText('Expense vendor or payee'), {
      target: { value: 'ISP Ltd' },
    });
    fireEvent.change(screen.getByLabelText('Expense payment method'), {
      target: { value: 'Personal card reimbursement' },
    });
    fireEvent.change(screen.getByLabelText('Expense reference'), {
      target: { value: 'INV-101' },
    });

    expect(onVendorNameChange).toHaveBeenCalledWith('ISP Ltd');
    expect(onPaymentMethodChange).toHaveBeenCalledWith(
      'Personal card reimbursement'
    );
    expect(onReferenceChange).toHaveBeenCalledWith('INV-101');
  });

  it('caps every optional metadata field at the persisted 120-character boundary', () => {
    render(
      <ExpenseMetadataFields
        onPaymentMethodChange={vi.fn()}
        onReferenceChange={vi.fn()}
        onVendorNameChange={vi.fn()}
        paymentMethod="Transfer"
        reference="INV-101"
        vendorName="ISP Ltd"
      />
    );

    for (const label of [
      'Expense vendor or payee',
      'Expense payment method',
      'Expense reference',
    ]) {
      expect(screen.getByLabelText(label)).toHaveAttribute('maxlength', '120');
    }
  });

  it('keeps metadata controls visible but unavailable while saving', () => {
    render(
      <ExpenseMetadataFields
        disabled
        onPaymentMethodChange={vi.fn()}
        onReferenceChange={vi.fn()}
        onVendorNameChange={vi.fn()}
        paymentMethod="Transfer"
        reference="INV-101"
        vendorName="ISP Ltd"
      />
    );

    expect(screen.getByLabelText('Expense vendor or payee')).toBeDisabled();
    expect(screen.getByLabelText('Expense payment method')).toBeDisabled();
    expect(screen.getByLabelText('Expense reference')).toBeDisabled();
  });
});
