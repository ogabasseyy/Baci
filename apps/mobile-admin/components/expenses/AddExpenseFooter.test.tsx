import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AddExpenseFooter } from './AddExpenseFooter';

vi.mock('react-native', () => ({
  ActivityIndicator: () => <output aria-label="saving" />,
  Pressable: ({
    accessibilityLabel,
    children,
    disabled,
    onPress,
  }: {
    accessibilityLabel?: string;
    children?: React.ReactNode;
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
  StyleSheet: { create: (styles: Record<string, unknown>) => styles },
  Text: ({ children }: { children?: React.ReactNode }) => (
    <span>{children}</span>
  ),
  View: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

const colors = {
  border: '#d1d5db',
  card: '#ffffff',
  primary: '#2563eb',
  textOnPrimary: '#ffffff',
};

describe('AddExpenseFooter', () => {
  it('disables save when the footer is disabled', () => {
    render(
      <AddExpenseFooter
        busy={false}
        colors={colors}
        disabled
        onSave={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Save expense' })).toBeDisabled();
  });

  it('forwards save when enabled', () => {
    const onSave = vi.fn();
    render(
      <AddExpenseFooter
        busy={false}
        colors={colors}
        disabled={false}
        onSave={onSave}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save expense' }));
    expect(onSave).toHaveBeenCalledOnce();
  });

  it('shows a busy indicator while saving', () => {
    render(
      <AddExpenseFooter
        busy
        colors={colors}
        disabled={false}
        onSave={vi.fn()}
      />
    );

    expect(screen.getByLabelText('saving')).toBeInTheDocument();
    expect(screen.queryByText('Save Expense')).not.toBeInTheDocument();
  });
});
