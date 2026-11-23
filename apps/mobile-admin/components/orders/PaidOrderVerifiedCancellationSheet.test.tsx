import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import { DARK_COLORS } from '@/constants/theme';
import { PaidOrderVerifiedCancellationSheet } from './PaidOrderVerifiedCancellationSheet';

vi.mock('@/components/ui/AppSheetModal', () => ({
  AppSheetModal: ({ children }: { children: ReactNode }) => (
    <section>{children}</section>
  ),
}));
vi.mock('react-native', () => ({
  Pressable: ({
    children,
    disabled,
    onPress,
  }: {
    children: ReactNode;
    disabled?: boolean;
    onPress: () => void;
  }) => (
    <button disabled={disabled} onClick={onPress} type="button">
      {children}
    </button>
  ),
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  TextInput: ({
    accessibilityLabel,
    onChangeText,
    value,
  }: {
    accessibilityLabel: string;
    onChangeText: (value: string) => void;
    value: string;
  }) => (
    <input
      aria-label={accessibilityLabel}
      onChange={(event) => onChangeText(event.target.value)}
      value={value}
    />
  ),
}));

it('gates confirmation until a reason and pending workspace are ready', () => {
  const confirm = vi.fn();
  const setReason = vi.fn();
  const props = {
    colors: DARK_COLORS,
    closing: false,
    reason: '',
    setReason,
    busy: false,
    recoveryRequired: false,
    pendingReady: false,
    canOpenVerifiedCancellation: true,
    verifiedCancellationReady: false,
    savedAction: null,
    message: '',
    onConfirm: confirm,
    onReload: vi.fn(),
    onClose: vi.fn(),
    retrySavedAction: vi.fn(() => null),
  };
  const { rerender } = render(
    <PaidOrderVerifiedCancellationSheet {...props} />
  );
  expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  rerender(
    <PaidOrderVerifiedCancellationSheet
      {...props}
      reason="Customer request"
      pendingReady
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  expect(confirm).toHaveBeenCalledOnce();
});

it('offers order reload when recovery is required', () => {
  const reload = vi.fn();
  render(
    <PaidOrderVerifiedCancellationSheet
      colors={DARK_COLORS}
      closing
      reason="Customer request"
      setReason={vi.fn()}
      busy={false}
      recoveryRequired
      pendingReady
      canOpenVerifiedCancellation
      verifiedCancellationReady
      savedAction={null}
      message="Check the order status."
      onConfirm={vi.fn()}
      onReload={reload}
      onClose={vi.fn()}
      retrySavedAction={vi.fn(() => null)}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Reload order status' }));
  expect(reload).toHaveBeenCalledOnce();
  expect(screen.getByText('Check the order status.')).toBeVisible();
});
