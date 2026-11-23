import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import { PaidOrderChangeAction } from './PaidOrderChangeAction';

vi.mock('@/hooks/useTheme', () => ({ useTheme: () => ({ colors: {} }) }));
vi.mock('react-native', () => ({
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Pressable: ({
    children,
    disabled,
    onPress,
    accessibilityState,
  }: {
    children: ReactNode;
    disabled: boolean;
    onPress: () => void;
    accessibilityState: { selected?: boolean };
  }) => (
    <button
      aria-pressed={accessibilityState.selected}
      disabled={disabled}
      onClick={onPress}
      type="button"
    >
      {children}
    </button>
  ),
}));

it('keeps the current line selected and disables actions during a request', () => {
  const onPress = vi.fn();
  const { rerender } = render(
    <PaidOrderChangeAction
      label="Original line"
      onPress={onPress}
      selected
      disabled
    />
  );
  const button = screen.getByRole('button', {
    name: 'Original line',
    pressed: true,
  });
  expect(button).toBeDisabled();
  fireEvent.click(button);
  expect(onPress).not.toHaveBeenCalled();
  rerender(
    <PaidOrderChangeAction
      label="Original line"
      onPress={onPress}
      selected
      disabled={false}
    />
  );
  fireEvent.click(button);
  expect(onPress).toHaveBeenCalledOnce();
});
