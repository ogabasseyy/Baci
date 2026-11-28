import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import type { ThemeColors } from '@/constants/theme';
import { PaidOrderChangePendingConfirmation } from './PaidOrderChangePendingConfirmation';

vi.mock('react-native', () => ({
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock('./PaidOrderChangeAction', () => ({
  PaidOrderChangeAction: ({
    label,
    onPress,
    disabled,
  }: {
    label: string;
    onPress: () => void;
    disabled: boolean;
  }) => (
    <button disabled={disabled} onClick={onPress} type="button">
      {label}
    </button>
  ),
}));

it('keeps check and retry actions separate and disables both while busy', () => {
  const onCheck = vi.fn();
  const onRetry = vi.fn();
  render(
    <PaidOrderChangePendingConfirmation
      colors={{} as ThemeColors}
      disabled
      onCheck={onCheck}
      onRetry={onRetry}
    />
  );

  expect(screen.getByText('A confirmation needs to be checked.')).toBeDefined();
  expect(
    (
      screen.getByRole('button', {
        name: 'Check confirmation status',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true);
  expect(
    (
      screen.getByRole('button', {
        name: 'Retry the same confirmation',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true);
  fireEvent.click(
    screen.getByRole('button', { name: 'Check confirmation status' })
  );
  expect(onCheck).not.toHaveBeenCalled();
  expect(onRetry).not.toHaveBeenCalled();
});

it('wires check and retry to their matching callbacks', () => {
  const onCheck = vi.fn();
  const onRetry = vi.fn();
  render(
    <PaidOrderChangePendingConfirmation
      colors={{} as ThemeColors}
      disabled={false}
      onCheck={onCheck}
      onRetry={onRetry}
    />
  );

  fireEvent.click(
    screen.getByRole('button', { name: 'Check confirmation status' })
  );
  expect(onCheck).toHaveBeenCalledOnce();
  expect(onRetry).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole('button', { name: 'Retry the same confirmation' })
  );
  expect(onCheck).toHaveBeenCalledOnce();
  expect(onRetry).toHaveBeenCalledOnce();
});
