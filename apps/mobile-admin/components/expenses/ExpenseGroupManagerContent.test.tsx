import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { ExpenseGroup } from '@/schemas/expense-group';
import { ExpenseGroupManagerContent } from './ExpenseGroupManagerContent';

const group: ExpenseGroup = {
  archived_at: null,
  created_at: '2026-08-09T12:00:00.000Z',
  id: '02f07db2-10e9-4c60-a0df-a4f5ccba9d9d',
  merchant_id: '97e7a9a4-4f82-484d-a0a5-0f2ba07f4e2e',
  name: 'Operations',
  updated_at: '2026-08-09T12:00:00.000Z',
};

const colors = {
  border: '#d1d5db',
  card: '#fff',
  error: '#ef4444',
  primary: '#2563eb',
  text: '#111827',
  textOnPrimary: '#fff',
  textSecondary: '#6b7280',
};

vi.mock('@react-native-vector-icons/ionicons', () => ({
  Ionicons: ({ name }: { name?: string }) => <span>{name}</span>,
  default: ({ name }: { name?: string }) => <span>{name}</span>,
  __esModule: true,
}));

vi.mock('react-native', () => ({
  ActivityIndicator: () => <span>Loading</span>,
  Pressable: ({
    accessibilityLabel,
    accessibilityRole,
    children,
    disabled,
    onPress,
  }: {
    accessibilityLabel?: string;
    accessibilityRole?: string;
    children?: ReactNode;
    disabled?: boolean;
    onPress?: () => void;
  }) => (
    <button
      aria-label={accessibilityLabel}
      disabled={disabled}
      onClick={onPress}
      role={accessibilityRole}
      type="button"
    >
      {children}
    </button>
  ),
  StyleSheet: { create: (styles: Record<string, unknown>) => styles },
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

describe('ExpenseGroupManagerContent', () => {
  it('renders active group actions only for editors', () => {
    const onArchiveSelect = vi.fn();
    const onRenameSelect = vi.fn();
    render(
      <ExpenseGroupManagerContent
        activeGroups={[group]}
        archiveTarget={null}
        busyAction={null}
        canEdit
        colors={colors}
        isBusy={false}
        onArchiveConfirm={vi.fn()}
        onArchiveDismiss={vi.fn()}
        onArchiveSelect={onArchiveSelect}
        onRenameSelect={onRenameSelect}
      />
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Rename Operations expense group' })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Archive Operations expense group' })
    );

    expect(onRenameSelect).toHaveBeenCalledWith(group);
    expect(onArchiveSelect).toHaveBeenCalledWith(group);
  });

  it('uses the approved explanation before confirming an archive', () => {
    const onArchiveConfirm = vi.fn();
    const onArchiveDismiss = vi.fn();
    render(
      <ExpenseGroupManagerContent
        activeGroups={[group]}
        archiveTarget={group}
        busyAction={null}
        canEdit
        colors={colors}
        isBusy={false}
        onArchiveConfirm={onArchiveConfirm}
        onArchiveDismiss={onArchiveDismiss}
        onArchiveSelect={vi.fn()}
        onRenameSelect={vi.fn()}
      />
    );

    expect(
      screen.getByText(
        'Existing expenses keep this group. It will no longer appear when adding or editing expenses.'
      )
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Cancel archive group' })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm archive group' })
    );

    expect(onArchiveDismiss).toHaveBeenCalledOnce();
    expect(onArchiveConfirm).toHaveBeenCalledOnce();
  });

  it('omits archive and rename mutations when editing is not permitted', () => {
    render(
      <ExpenseGroupManagerContent
        activeGroups={[group]}
        archiveTarget={null}
        busyAction={null}
        canEdit={false}
        colors={colors}
        isBusy={false}
        onArchiveConfirm={vi.fn()}
        onArchiveDismiss={vi.fn()}
        onArchiveSelect={vi.fn()}
        onRenameSelect={vi.fn()}
      />
    );

    expect(screen.getByText('Operations')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Rename Operations expense group' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Archive Operations expense group' })
    ).not.toBeInTheDocument();
  });
});
