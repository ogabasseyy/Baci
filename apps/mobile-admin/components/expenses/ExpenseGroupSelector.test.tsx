import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { ExpenseGroup } from '@/schemas/expense-group';
import { ExpenseGroupSelector } from './ExpenseGroupSelector';

const groups: ExpenseGroup[] = [
  {
    archived_at: null,
    created_at: '2026-08-09T12:00:00.000Z',
    id: '02f07db2-10e9-4c60-a0df-a4f5ccba9d9d',
    merchant_id: '97e7a9a4-4f82-484d-a0a5-0f2ba07f4e2e',
    name: 'Operations',
    updated_at: '2026-08-09T12:00:00.000Z',
  },
  {
    archived_at: null,
    created_at: '2026-08-09T12:00:00.000Z',
    id: '2f810d8f-1247-4a6d-8f49-33c1eeb0d61a',
    merchant_id: '97e7a9a4-4f82-484d-a0a5-0f2ba07f4e2e',
    name: 'Marketing',
    updated_at: '2026-08-09T12:00:00.000Z',
  },
];

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      border: '#d1d5db',
      card: '#f8fafc',
      primary: '#2563eb',
      text: '#111827',
      textSecondary: '#6b7280',
    },
  }),
}));

vi.mock('@react-native-vector-icons/ionicons', () => ({
  Ionicons: ({ name }: { name?: string }) => <span>{name}</span>,
  default: ({ name }: { name?: string }) => <span>{name}</span>,
  __esModule: true,
}));

vi.mock('react-native', () => ({
  Pressable: ({
    accessibilityLabel,
    accessibilityRole,
    accessibilityState,
    children,
    disabled,
    onPress,
  }: {
    accessibilityLabel?: string;
    accessibilityRole?: string;
    accessibilityState?: { checked?: boolean; disabled?: boolean };
    children?: ReactNode;
    disabled?: boolean;
    onPress?: () => void;
  }) => (
    <button
      aria-label={accessibilityLabel}
      disabled={disabled}
      onClick={onPress}
      {...(accessibilityRole === 'radio'
        ? { 'aria-checked': accessibilityState?.checked, role: 'radio' }
        : { role: accessibilityRole })}
      type="button"
    >
      {children}
    </button>
  ),
  StyleSheet: { create: (styles: Record<string, unknown>) => styles },
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  View: ({
    accessibilityRole,
    children,
  }: {
    accessibilityRole?: string;
    children?: ReactNode;
  }) => <div role={accessibilityRole}>{children}</div>,
}));

describe('ExpenseGroupSelector', () => {
  it('renders no-group and active group options with the current selection', () => {
    render(
      <ExpenseGroupSelector
        activeGroups={groups}
        canEdit
        onManage={vi.fn()}
        onSelect={vi.fn()}
        selectedGroupId={groups[1]?.id ?? null}
      />
    );

    expect(
      screen.getByRole('radio', { name: 'No expense group' })
    ).toHaveAttribute('aria-checked', 'false');
    expect(
      screen.getByRole('radio', { name: 'Assign expense to Operations group' })
    ).toHaveAttribute('aria-checked', 'false');
    expect(
      screen.getByRole('radio', { name: 'Assign expense to Marketing group' })
    ).toHaveAttribute('aria-checked', 'true');
    expect(
      screen.getByRole('button', { name: 'Manage expense groups' })
    ).toBeInTheDocument();
  });

  it('forwards selection and group-management actions', () => {
    const onManage = vi.fn();
    const onSelect = vi.fn();
    render(
      <ExpenseGroupSelector
        activeGroups={groups}
        canEdit
        onManage={onManage}
        onSelect={onSelect}
        selectedGroupId={groups[0]?.id ?? null}
      />
    );

    fireEvent.click(screen.getByRole('radio', { name: 'No expense group' }));
    fireEvent.click(
      screen.getByRole('radio', { name: 'Assign expense to Marketing group' })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Manage expense groups' })
    );

    expect(onSelect).toHaveBeenNthCalledWith(1, null);
    expect(onSelect).toHaveBeenNthCalledWith(2, groups[1]?.id);
    expect(onManage).toHaveBeenCalledOnce();
  });

  it('keeps selection available but structurally omits management without edit permission', () => {
    render(
      <ExpenseGroupSelector
        activeGroups={[]}
        canEdit={false}
        onManage={vi.fn()}
        onSelect={vi.fn()}
        selectedGroupId={null}
      />
    );

    expect(
      screen.getByRole('radio', { name: 'No expense group' })
    ).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('No active groups yet')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Manage expense groups' })
    ).not.toBeInTheDocument();
  });

  it('disables selection and group management without changing permission visibility', () => {
    const onManage = vi.fn();
    const onSelect = vi.fn();

    render(
      <ExpenseGroupSelector
        activeGroups={groups}
        canEdit
        disabled
        onManage={onManage}
        onSelect={onSelect}
        selectedGroupId={groups[0]?.id ?? null}
      />
    );

    const noGroup = screen.getByRole('radio', { name: 'No expense group' });
    const marketingGroup = screen.getByRole('radio', {
      name: 'Assign expense to Marketing group',
    });
    const manageGroups = screen.getByRole('button', {
      name: 'Manage expense groups',
    });
    expect(noGroup).toBeDisabled();
    expect(marketingGroup).toBeDisabled();
    expect(manageGroups).toBeDisabled();

    fireEvent.click(noGroup);
    fireEvent.click(marketingGroup);
    fireEvent.click(manageGroups);

    expect(onSelect).not.toHaveBeenCalled();
    expect(onManage).not.toHaveBeenCalled();
  });
});
