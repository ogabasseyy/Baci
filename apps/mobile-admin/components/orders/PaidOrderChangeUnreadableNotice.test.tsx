import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import type { ThemeColors } from '@/constants/theme';
import { PaidOrderChangeUnreadableNotice } from './PaidOrderChangeUnreadableNotice';

vi.mock('react-native', () => ({
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled: boolean;
  }) => (
    <button disabled={disabled} onClick={onPress} type="button">
      {children}
    </button>
  ),
}));

it('explains unreadable saved state and disables reload while busy', () => {
  const onReload = vi.fn();
  render(
    <PaidOrderChangeUnreadableNotice
      colors={{} as ThemeColors}
      disabled
      onReload={onReload}
    />
  );

  expect(
    screen.getByText(/saved confirmation could not be read/i)
  ).toBeDefined();
  expect(
    (
      screen.getByRole('button', {
        name: 'Reload order status',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Reload order status' }));
  expect(onReload).not.toHaveBeenCalled();
});

it('reloads order status when enabled', () => {
  const onReload = vi.fn();
  render(
    <PaidOrderChangeUnreadableNotice
      colors={{} as ThemeColors}
      disabled={false}
      onReload={onReload}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Reload order status' }));
  expect(onReload).toHaveBeenCalledOnce();
});
