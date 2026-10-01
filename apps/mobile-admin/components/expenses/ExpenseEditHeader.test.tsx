import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DARK_COLORS } from '@/constants/theme';
import { ExpenseEditHeader } from './ExpenseEditHeader';

const capturedOptions = vi.hoisted(() => ({
  value: null as {
    headerLeft?: () => ReactNode;
    title?: string;
  } | null,
}));

vi.mock('@react-native-vector-icons/ionicons', () => ({
  Ionicons: ({ name }: { name: string }) => <span data-icon={name} />,
  default: ({ name }: { name: string }) => <span data-icon={name} />,
  __esModule: true,
}));

vi.mock('expo-router', () => ({
  Stack: {
    Screen: ({
      options,
    }: {
      options: {
        headerLeft?: () => ReactNode;
        title?: string;
      };
    }) => {
      capturedOptions.value = options;
      return <>{options.headerLeft?.()}</>;
    },
  },
}));

vi.mock('react-native', () => ({
  Pressable: ({
    accessibilityLabel,
    children,
    onPress,
  }: {
    accessibilityLabel?: string;
    children?: ReactNode;
    onPress?: () => void;
  }) => (
    <button aria-label={accessibilityLabel} onClick={onPress} type="button">
      {children}
    </button>
  ),
}));

const colors = DARK_COLORS;

describe('ExpenseEditHeader', () => {
  it('configures the edit title and closes when pressed', () => {
    const onClose = vi.fn();

    render(<ExpenseEditHeader colors={colors} onClose={onClose} />);

    expect(capturedOptions.value?.title).toBe('Edit Expense');
    fireEvent.click(
      screen.getByRole('button', { name: 'Close edit expense screen' })
    );
    expect(onClose).toHaveBeenCalledOnce();
  });
});
