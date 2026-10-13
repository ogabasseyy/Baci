import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExpenseGroup } from '@/schemas/expense-group';
import { ExpenseGroupManagerSheet } from './ExpenseGroupManagerSheet';

const group: ExpenseGroup = {
  archived_at: null,
  created_at: '2026-08-09T12:00:00.000Z',
  id: '02f07db2-10e9-4c60-a0df-a4f5ccba9d9d',
  merchant_id: '97e7a9a4-4f82-484d-a0a5-0f2ba07f4e2e',
  name: 'Operations',
  updated_at: '2026-08-09T12:00:00.000Z',
};

vi.mock('@/components/ui/AppSheetModal', () => ({
  AppSheetModal: ({
    accessibilityLabel,
    children,
    visible,
  }: {
    accessibilityLabel?: string;
    children?: ReactNode;
    visible?: boolean;
  }) =>
    visible ? (
      <section aria-label={accessibilityLabel}>{children}</section>
    ) : null,
}));

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      border: '#d1d5db',
      card: '#f8fafc',
      error: '#ef4444',
      inputBg: '#f1f5f9',
      primary: '#2563eb',
      text: '#111827',
      textOnPrimary: '#fff',
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
  ScrollView: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  StyleSheet: { create: (styles: Record<string, unknown>) => styles },
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  TextInput: ({
    accessibilityLabel,
    editable = true,
    onChangeText,
    value,
  }: {
    accessibilityLabel?: string;
    editable?: boolean;
    onChangeText?: (value: string) => void;
    value?: string;
  }) => (
    <input
      aria-label={accessibilityLabel}
      disabled={!editable}
      onChange={(event) => onChangeText?.(event.target.value)}
      value={value}
    />
  ),
  View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

describe('ExpenseGroupManagerSheet', () => {
  const createGroup = vi.fn<() => Promise<ExpenseGroup>>();
  const renameGroup = vi.fn<() => Promise<void>>();
  const archiveGroup = vi.fn<() => Promise<void>>();

  const renderSheet = (canEdit = true) =>
    render(
      <ExpenseGroupManagerSheet
        canEdit={canEdit}
        createGroup={createGroup}
        groups={[group]}
        onClose={vi.fn()}
        renameGroup={renameGroup}
        archiveGroup={archiveGroup}
        visible
      />
    );

  beforeEach(() => {
    vi.clearAllMocks();
    createGroup.mockResolvedValue(group);
    renameGroup.mockResolvedValue(undefined);
    archiveGroup.mockResolvedValue(undefined);
  });

  it('creates a trimmed group name through an accessible form', async () => {
    renderSheet();

    fireEvent.change(screen.getByLabelText('New expense group name'), {
      target: { value: '  Marketing  ' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Create expense group' })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Creating expense group' })
    );

    await waitFor(() => expect(createGroup).toHaveBeenCalledWith('Marketing'));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Create expense group' })
      ).toBeDisabled()
    );
  });

  it('renames a group and requires confirmation before archiving it', async () => {
    renderSheet();

    fireEvent.click(
      screen.getByRole('button', { name: 'Rename Operations expense group' })
    );
    fireEvent.change(
      screen.getByLabelText('New name for Operations expense group'),
      { target: { value: 'Team operations' } }
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save group name' }));

    await waitFor(() =>
      expect(renameGroup).toHaveBeenCalledWith(group.id, 'Team operations')
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Archive Operations expense group' })
    );
    expect(
      screen.getByText(
        'Existing expenses keep this group. It will no longer appear when adding or editing expenses.'
      )
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm archive group' })
    );

    await waitFor(() => expect(archiveGroup).toHaveBeenCalledWith(group.id));
  });

  it('shows a clear duplicate error and prevents duplicate submissions while busy', async () => {
    let resolveCreate: ((value: ExpenseGroup) => void) | undefined;
    createGroup.mockImplementation(
      () =>
        new Promise<ExpenseGroup>((resolve) => {
          resolveCreate = resolve;
        })
    );
    renderSheet();

    fireEvent.change(screen.getByLabelText('New expense group name'), {
      target: { value: 'Marketing' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Create expense group' })
    );

    expect(
      screen.getByRole('button', { name: 'Creating expense group' })
    ).toBeDisabled();
    expect(createGroup).toHaveBeenCalledTimes(1);
    resolveCreate?.(group);

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Create expense group' })
      ).toBeInTheDocument()
    );

    createGroup.mockRejectedValueOnce(
      new Error('An active expense group with this name already exists.')
    );
    fireEvent.change(screen.getByLabelText('New expense group name'), {
      target: { value: 'Marketing' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Create expense group' })
    );

    await waitFor(() =>
      expect(
        screen.getByText(
          'An active expense group with this name already exists.'
        )
      ).toBeInTheDocument()
    );
  });

  it('keeps the group list visible but omits every mutation control without edit permission', () => {
    renderSheet(false);

    expect(screen.getByText('Operations')).toBeInTheDocument();
    expect(
      screen.queryByLabelText('New expense group name')
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Create expense group' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: 'Rename Operations expense group',
      })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: 'Archive Operations expense group',
      })
    ).not.toBeInTheDocument();
  });
});
