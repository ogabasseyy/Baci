import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import type { ThemeColors } from '@/constants/theme';
import { PaidOrderSettlementAction } from './PaidOrderSettlementAction';

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
}));

const colors = { primary: 'blue', textMuted: 'gray' } as ThemeColors;

it('blocks new actions with stale data but leaves recovery actions available', () => {
  const onNewAction = vi.fn();
  const onReload = vi.fn();
  render(
    <>
      <PaidOrderSettlementAction
        label="Put order on hold for cancellation"
        onPress={onNewAction}
        disabled={false}
        busy={false}
        workspaceFresh={false}
        allowWhenWorkspaceStale={false}
        colors={colors}
      />
      <PaidOrderSettlementAction
        label="Reload order status"
        onPress={onReload}
        disabled={false}
        busy={false}
        workspaceFresh={false}
        allowWhenWorkspaceStale
        colors={colors}
      />
    </>
  );

  expect(
    screen.getByRole('button', { name: 'Put order on hold for cancellation' })
  ).toBeDisabled();
  const reload = screen.getByRole('button', { name: 'Reload order status' });
  expect(reload).toBeEnabled();
  fireEvent.click(reload);
  expect(onReload).toHaveBeenCalledOnce();
  expect(onNewAction).not.toHaveBeenCalled();
});

it('disables recovery actions while another request is busy', () => {
  render(
    <PaidOrderSettlementAction
      label="Retry the same settlement request"
      onPress={vi.fn()}
      disabled={false}
      busy
      workspaceFresh={false}
      allowWhenWorkspaceStale
      colors={colors}
    />
  );
  expect(
    screen.getByRole('button', { name: 'Retry the same settlement request' })
  ).toBeDisabled();
});

it('uses stale-workspace permission independently of the label', () => {
  render(
    <>
      <PaidOrderSettlementAction
        label="Retry wording without recovery permission"
        onPress={vi.fn()}
        disabled={false}
        busy={false}
        workspaceFresh={false}
        allowWhenWorkspaceStale={false}
        colors={colors}
      />
      <PaidOrderSettlementAction
        label="Continue a saved request"
        onPress={vi.fn()}
        disabled={false}
        busy={false}
        workspaceFresh={false}
        allowWhenWorkspaceStale
        colors={colors}
      />
    </>
  );

  expect(
    screen.getByRole('button', {
      name: 'Retry wording without recovery permission',
    })
  ).toBeDisabled();
  expect(
    screen.getByRole('button', { name: 'Continue a saved request' })
  ).toBeEnabled();
});
