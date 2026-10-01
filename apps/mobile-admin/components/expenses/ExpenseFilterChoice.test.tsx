import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@react-native-vector-icons/ionicons', () => ({
  default: ({ name }: { name: string }) => <span>{name}</span>,
  __esModule: true,
}));

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      border: '#334155',
      card: '#111827',
      primary: '#3b82f6',
      primaryLight: '#dbeafe',
      text: '#f8fafc',
    },
  }),
}));

vi.mock('react-native', () => ({
  Pressable: ({
    accessibilityLabel,
    accessibilityState,
    children,
    onPress,
  }: {
    accessibilityLabel: string;
    accessibilityState?: { selected?: boolean };
    children?: ReactNode;
    onPress: () => void;
  }) => (
    <button
      aria-label={accessibilityLabel}
      data-selected={accessibilityState?.selected}
      onClick={onPress}
      type="button"
    >
      {children}
    </button>
  ),
  StyleSheet: { create: (styles: Record<string, unknown>) => styles },
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

import { ExpenseFilterChoice } from './ExpenseFilterChoice';

describe('ExpenseFilterChoice', () => {
  it('exposes a selected option to assistive technology and triggers its selection', () => {
    const onPress = vi.fn();

    render(
      <ExpenseFilterChoice
        accessibilityLabel="Filter category Travel"
        label="Travel"
        onPress={onPress}
        selected
      />
    );

    const choice = screen.getByRole('button', {
      name: 'Filter category Travel',
    });
    expect(choice).toHaveAttribute('data-selected', 'true');
    expect(screen.getByText('checkmark')).toBeInTheDocument();

    fireEvent.click(choice);

    expect(onPress).toHaveBeenCalledOnce();
  });

  it('marks an unselected option as false without displaying a checkmark', () => {
    render(
      <ExpenseFilterChoice
        accessibilityLabel="Filter category Utilities"
        label="Utilities"
        onPress={vi.fn()}
        selected={false}
      />
    );

    expect(
      screen.getByRole('button', { name: 'Filter category Utilities' })
    ).toHaveAttribute('data-selected', 'false');
    expect(screen.queryByText('checkmark')).not.toBeInTheDocument();
  });
});
