import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ExpenseEditFormFooter } from './ExpenseEditFormFooter';

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

describe('ExpenseEditFormFooter', () => {
  it('disables save until the form is dirty', () => {
    render(
      <ExpenseEditFormFooter
        colors={colors}
        disabled={false}
        isDirty={false}
        isPending={false}
        onSave={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Save expense' })).toBeDisabled();
  });

  it('forwards save when the form is dirty and enabled', () => {
    const onSave = vi.fn();
    render(
      <ExpenseEditFormFooter
        colors={colors}
        disabled={false}
        isDirty
        isPending={false}
        onSave={onSave}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save expense' }));
    expect(onSave).toHaveBeenCalledOnce();
  });
});
