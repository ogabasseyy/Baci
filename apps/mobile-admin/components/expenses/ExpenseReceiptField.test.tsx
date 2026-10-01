import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { ExpenseReceiptChange } from '@/hooks/useExpenseFormState';
import { ExpenseReceiptField } from './ExpenseReceiptField';

vi.mock('@/components/ui/SafeImage', () => ({
  default: ({
    accessibilityLabel,
    source,
  }: {
    accessibilityLabel?: string;
    source?: { uri?: string };
  }) => <img alt={accessibilityLabel} data-src={source?.uri} />,
}));

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      border: '#d1d5db',
      card: '#f8fafc',
      primary: '#2563eb',
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
    children,
    disabled,
    onPress,
  }: {
    accessibilityLabel?: string;
    accessibilityRole?: string;
    children?: ReactNode;
    disabled?: boolean;
    onPress?: () => void;
  }) => (
    <button
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
  View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

function renderReceiptField(
  receiptChange: ExpenseReceiptChange,
  overrides: Partial<{
    disabled: boolean;
    existingReceiptUri: string | null;
    onRemoveReceipt: () => void;
    onRestoreReceipt: () => void;
    onSelectReceipt: () => void;
    receiptError: Error | null;
    receiptLoading: boolean;
  }> = {}
) {
  return render(
    <ExpenseReceiptField
      existingReceiptUri="https://example.com/receipts/existing.jpg"
      onRemoveReceipt={vi.fn()}
      onSelectReceipt={vi.fn()}
      receiptChange={receiptChange}
      {...overrides}
    />
  );
}

describe('ExpenseReceiptField', () => {
  it('labels an attached persisted receipt separately from a new local replacement', () => {
    const { rerender } = renderReceiptField({ kind: 'unchanged' });

    expect(
      screen.getByRole('img', { name: 'Existing receipt preview' })
    ).toHaveAttribute('data-src', 'https://example.com/receipts/existing.jpg');
    expect(screen.getByText('Existing receipt attached')).toBeInTheDocument();

    rerender(
      <ExpenseReceiptField
        existingReceiptUri="https://example.com/receipts/existing.jpg"
        onRemoveReceipt={vi.fn()}
        onSelectReceipt={vi.fn()}
        receiptChange={{ kind: 'replace', localUri: 'file:///new-receipt.jpg' }}
      />
    );

    expect(
      screen.getByRole('img', { name: 'New receipt preview' })
    ).toHaveAttribute('data-src', 'file:///new-receipt.jpg');
    expect(screen.getByText('New receipt selected')).toBeInTheDocument();
  });

  it('forwards add, replace, and remove actions without persisting receipt state', () => {
    const onRemoveReceipt = vi.fn();
    const onSelectReceipt = vi.fn();
    const { rerender } = renderReceiptField(
      { kind: 'unchanged' },
      { onRemoveReceipt, onSelectReceipt }
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Replace expense receipt' })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove expense receipt' })
    );

    expect(onSelectReceipt).toHaveBeenCalledOnce();
    expect(onRemoveReceipt).toHaveBeenCalledOnce();

    rerender(
      <ExpenseReceiptField
        existingReceiptUri="https://example.com/receipts/existing.jpg"
        onRemoveReceipt={onRemoveReceipt}
        onSelectReceipt={onSelectReceipt}
        receiptChange={{ kind: 'remove' }}
      />
    );

    expect(
      screen.getByText('Receipt will be removed when you save.')
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Add expense receipt' })
    );

    expect(onSelectReceipt).toHaveBeenCalledTimes(2);
  });

  it('offers a restore action for an existing receipt marked for removal', () => {
    const onRestoreReceipt = vi.fn();
    const onSelectReceipt = vi.fn();

    renderReceiptField(
      { kind: 'remove' },
      { onRestoreReceipt, onSelectReceipt }
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Restore expense receipt' })
    );

    expect(onRestoreReceipt).toHaveBeenCalledOnce();
    expect(onSelectReceipt).not.toHaveBeenCalled();
  });

  it('renders an accessible add action when no receipt has been selected', () => {
    renderReceiptField({ kind: 'unchanged' }, { existingReceiptUri: null });

    expect(
      screen.getByRole('button', { name: 'Add expense receipt' })
    ).toBeInTheDocument();
  });

  it('disables receipt actions while the enclosing form is disabled', () => {
    renderReceiptField(
      { kind: 'replace', localUri: 'file:///new-receipt.jpg' },
      { disabled: true }
    );

    expect(
      screen.getByRole('button', { name: 'Replace expense receipt' })
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Remove expense receipt' })
    ).toBeDisabled();
  });

  it('surfaces an existing-receipt signing failure while allowing replacement', () => {
    const onRemoveReceipt = vi.fn();
    const onSelectReceipt = vi.fn();
    renderReceiptField(
      { kind: 'unchanged' },
      {
        onRemoveReceipt,
        onSelectReceipt,
        receiptError: new Error('signing failed'),
      }
    );

    expect(
      screen.getByText(
        'Could not load the existing receipt. You can replace it.'
      )
    ).toBeInTheDocument();
    const replace = screen.getByRole('button', {
      name: 'Add expense receipt',
    });
    const remove = screen.getByRole('button', {
      name: 'Remove expense receipt',
    });
    expect(replace).toBeEnabled();
    expect(remove).toBeEnabled();
    fireEvent.click(replace);
    fireEvent.click(remove);
    expect(onSelectReceipt).toHaveBeenCalledOnce();
    expect(onRemoveReceipt).toHaveBeenCalledOnce();
  });

  it('keeps a newly selected replacement visible after an old receipt signing failure', () => {
    renderReceiptField(
      { kind: 'replace', localUri: 'file:///new-receipt.jpg' },
      { receiptError: new Error('signing failed') }
    );

    expect(
      screen.getByRole('img', { name: 'New receipt preview' })
    ).toHaveAttribute('data-src', 'file:///new-receipt.jpg');
  });

  it('allows removing an invalid legacy receipt without a signing error', () => {
    const onRemoveReceipt = vi.fn();
    const onSelectReceipt = vi.fn();

    render(
      <ExpenseReceiptField
        existingReceiptUri={null}
        hasExistingReceipt
        onRemoveReceipt={onRemoveReceipt}
        onSelectReceipt={onSelectReceipt}
        receiptChange={{ kind: 'unchanged' }}
      />
    );

    const remove = screen.getByRole('button', {
      name: 'Remove expense receipt',
    });
    expect(remove).toBeEnabled();
    fireEvent.click(remove);
    expect(onRemoveReceipt).toHaveBeenCalledOnce();
  });
});
