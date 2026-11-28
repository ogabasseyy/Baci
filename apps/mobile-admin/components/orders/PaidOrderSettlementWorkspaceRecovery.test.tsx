import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import type { ThemeColors } from '@/constants/theme';
import { PaidOrderSettlementWorkspaceRecovery } from './PaidOrderSettlementWorkspaceRecovery';

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
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const colors = {
  text: 'black',
  textMuted: 'gray',
  primary: 'blue',
} as ThemeColors;

it('offers reload for stale workspace data and disables it while busy', () => {
  const onReload = vi.fn();
  const common = {
    colors,
    busy: false,
    pendingReadError: false,
    unreadableMessage: false,
    recoveryRequired: false,
    showGeneralReload: true,
    verifiedCancellationPending: false,
    verifiedCancellationReady: false,
    onRetryPending: vi.fn(),
    onReload,
  };

  const view = render(
    <PaidOrderSettlementWorkspaceRecovery {...common} workspaceFresh={false} />
  );
  expect(
    screen.getByRole('button', { name: 'Reload order status' })
  ).toBeEnabled();
  view.rerender(
    <PaidOrderSettlementWorkspaceRecovery
      {...common}
      workspaceFresh
      busy
      recoveryRequired
    />
  );
  expect(
    screen.getByRole('button', { name: 'Reload order status' })
  ).toBeDisabled();
});

it('keeps saved-request retry and cancellation guidance available', () => {
  const onRetryPending = vi.fn();
  render(
    <PaidOrderSettlementWorkspaceRecovery
      colors={colors}
      busy={false}
      pendingReadError
      unreadableMessage
      recoveryRequired
      workspaceFresh={false}
      showGeneralReload={false}
      verifiedCancellationPending
      verifiedCancellationReady={false}
      onRetryPending={onRetryPending}
      onReload={vi.fn()}
    />
  );

  expect(
    screen.getByText(
      'Fulfillment is on hold while Finance verifies each refund.'
    )
  ).toBeDefined();
  fireEvent.click(
    screen.getByRole('button', { name: 'Retry saved settlement check' })
  );
  expect(onRetryPending).toHaveBeenCalledOnce();
  expect(
    screen.getByText(/saved settlement request could not be read/i)
  ).toBeDefined();
});
