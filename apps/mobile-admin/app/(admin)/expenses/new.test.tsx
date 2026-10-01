import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExpenseGroup } from '@/schemas/expense-group';

const merchantId = '97e7a9a4-4f82-484d-a0a5-0f2ba07f4e2e';
const branchId = '8b3f1444-8890-4b6a-a00f-ae80949f05b2';
const groupId = 'f4067728-3048-4f49-a6c2-0d6b891c43d7';
const mocks = vi.hoisted(() => ({
  alert: vi.fn(),
  branchScope: {
    type: 'branch',
    branchId: '8b3f1444-8890-4b6a-a00f-ae80949f05b2',
  } as { type: 'all' } | { type: 'branch'; branchId: string },
  branches: [
    {
      active: true,
      id: '8b3f1444-8890-4b6a-a00f-ae80949f05b2',
      is_default: true,
      name: 'Lagos main',
    },
  ] as
    | Array<{
        active: boolean;
        id: string;
        is_default: boolean;
        name: string;
      }>
    | undefined,
  branchesError: null as Error | null,
  canCreate: true,
  error: null as Error | null,
  groups: [
    {
      archived_at: null,
      created_at: '2026-08-01T00:00:00.000Z',
      id: 'f4067728-3048-4f49-a6c2-0d6b891c43d7',
      merchant_id: '97e7a9a4-4f82-484d-a0a5-0f2ba07f4e2e',
      name: 'Marketing',
      updated_at: '2026-08-01T00:00:00.000Z',
    },
  ] as ExpenseGroup[],
  groupsError: null as Error | null,
  hasCachedGroups: true,
  imagePicker: vi.fn(),
  isAccessLoading: false,
  invalidateQueries: vi.fn(),
  mutate: vi.fn(),
  router: { back: vi.fn() },
}));
vi.mock('@tanstack/react-query', () => ({
  useMutation: () => ({ isPending: false, mutate: vi.fn() }),
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));
vi.mock('@/hooks/useExpenseAccess', () => ({
  useExpenseAccess: () => ({
    canCreate: mocks.canCreate,
    canEdit: mocks.canCreate,
    canView: mocks.canCreate,
    error: mocks.error,
    isLoading: mocks.isAccessLoading,
  }),
}));
vi.mock('@/hooks/useMerchant', () => ({
  useMerchant: () => ({ merchant: { id: merchantId } }),
}));
vi.mock('@/hooks/useBranchScope', () => ({
  useBranchScope: () => ({ scope: mocks.branchScope }),
}));
vi.mock('@/hooks/useBranches', () => ({
  useBranches: () => ({
    data: mocks.branches,
    error: mocks.branchesError,
    isLoading: false,
    refetch: vi.fn(),
  }),
}));
vi.mock('@/hooks/useExpenseGroups', () => ({
  useExpenseGroups: () => ({
    activeGroups: mocks.groups.filter((group) => group.archived_at === null),
    allGroups: mocks.groups,
    archiveGroup: vi.fn(),
    createGroup: vi.fn(),
    error: mocks.groupsError,
    hasCachedGroups: mocks.hasCachedGroups,
    isLoading: false,
    refetch: vi.fn(),
    renameGroup: vi.fn(),
  }),
}));
vi.mock('@/hooks/useSaveExpense', () => ({
  useSaveExpense: () => ({ isPending: false, mutate: mocks.mutate }),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {},
}));

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      background: '#020617',
      border: '#334155',
      card: '#111827',
      primary: '#3b82f6',
      text: '#f8fafc',
      textOnPrimary: '#ffffff',
      textSecondary: '#cbd5e1',
    },
  }),
}));

vi.mock('@/components/ui/AppFormScreen', () => ({
  AppFormScreen: ({
    children,
    footer,
  }: {
    children?: ReactNode;
    footer?: ReactNode;
  }) => (
    <section aria-label="expense form">
      {children}
      {footer}
    </section>
  ),
}));

vi.mock('@/components/expenses/ExpenseFormFields', () => ({
  ExpenseFormFields: (props: {
    amount: string;
    date: string;
    onAmountChange: (value: string) => void;
    onDateChange: (value: string) => void;
    onDescriptionChange: (value: string) => void;
    onGroupChange: (value: string | null) => void;
    onPaymentMethodChange: (value: string) => void;
    onReferenceChange: (value: string) => void;
    onVendorNameChange: (value: string) => void;
  }) => (
    <>
      <output aria-label="default expense date">{props.date}</output>
      <input
        aria-label="Expense amount"
        onChange={(event) => props.onAmountChange(event.target.value)}
        value={props.amount}
      />
      <input
        aria-label="Expense description"
        onChange={(event) => props.onDescriptionChange(event.target.value)}
      />
      <input
        aria-label="Expense vendor or payee"
        onChange={(event) => props.onVendorNameChange(event.target.value)}
      />
      <input
        aria-label="Expense payment method"
        onChange={(event) => props.onPaymentMethodChange(event.target.value)}
      />
      <input
        aria-label="Expense reference"
        onChange={(event) => props.onReferenceChange(event.target.value)}
      />
      <button onClick={() => props.onDateChange('2026-08-08')} type="button">
        Choose date
      </button>
      <button onClick={() => props.onGroupChange(groupId)} type="button">
        Choose group
      </button>
    </>
  ),
}));

vi.mock('@/components/expenses/ExpenseCategorySheet', () => ({
  ExpenseCategorySheet: () => null,
}));

vi.mock('@/components/expenses/ExpenseGroupManagerSheet', () => ({
  ExpenseGroupManagerSheet: ({
    archiveGroup,
  }: {
    archiveGroup: (id: string) => Promise<void>;
  }) => (
    <button onClick={() => void archiveGroup(groupId)} type="button">
      Archive selected group
    </button>
  ),
}));

vi.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: mocks.imagePicker,
}));

vi.mock('expo-router', () => ({
  Stack: {
    Screen: ({ options }: { options?: { headerLeft?: () => ReactNode } }) => (
      <>{options?.headerLeft?.()}</>
    ),
  },
  useNavigation: () => ({ dispatch: vi.fn() }),
  useRouter: () => mocks.router,
}));
vi.mock('expo-router/react-navigation', () => ({
  usePreventRemove: vi.fn(),
}));
vi.mock('@react-native-vector-icons/ionicons', () => ({
  default: () => null,
  Ionicons: () => null,
  __esModule: true,
}));

vi.mock('react-native', () => ({
  ActivityIndicator: () => <output aria-label="saving" />,
  Alert: { alert: mocks.alert },
  Pressable: ({
    accessibilityLabel,
    children,
    disabled,
    onPress,
  }: {
    accessibilityLabel?: string;
    children?: ReactNode;
    disabled?: boolean;
    onPress?: () => void;
  }) => (
    <button
      aria-label={accessibilityLabel}
      disabled={disabled}
      onClick={onPress}
      type="button"
    >
      {children}
    </button>
  ),
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  StyleSheet: { create: (value: unknown) => value },
}));

import AddExpenseScreen from './new';

describe('AddExpenseScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 9, 11, 0));
    mocks.branchScope = { type: 'branch', branchId };
    mocks.branches = [
      {
        active: true,
        id: '8b3f1444-8890-4b6a-a00f-ae80949f05b2',
        is_default: true,
        name: 'Lagos main',
      },
    ];
    mocks.branchesError = null;
    mocks.groupsError = null;
    mocks.hasCachedGroups = true;
    mocks.mutate.mockImplementation(
      (_input: unknown, options?: { onSuccess?: () => void }) =>
        options?.onSuccess?.()
    );
  });
  afterEach(() => vi.useRealTimers());
  it('uses today and sends every editable field through the save mutation in the authoritative branch', async () => {
    render(<AddExpenseScreen />);

    expect(screen.getByLabelText('default expense date').textContent).toBe(
      '2026-08-09'
    );
    fireEvent.change(screen.getByLabelText('Expense amount'), {
      target: { value: '12,500' },
    });
    fireEvent.change(screen.getByLabelText('Expense description'), {
      target: { value: 'Office internet' },
    });
    fireEvent.change(screen.getByLabelText('Expense vendor or payee'), {
      target: { value: 'ISP Ltd' },
    });
    fireEvent.change(screen.getByLabelText('Expense payment method'), {
      target: { value: 'Transfer' },
    });
    fireEvent.change(screen.getByLabelText('Expense reference'), {
      target: { value: 'INV-101' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Choose date' }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose group' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save expense' }));

    expect(mocks.mutate).toHaveBeenCalledWith(
      {
        merchantId,
        mode: 'create',
        receiptChange: { kind: 'unchanged' },
        values: {
          amount: 12500,
          branchId,
          category: 'Inventory',
          date: '2026-08-08',
          description: 'Office internet',
          groupId,
          paymentMethod: 'Transfer',
          reference: 'INV-101',
          vendorName: 'ISP Ltd',
        },
      },
      expect.any(Object)
    );
    expect(mocks.router.back).toHaveBeenCalled();
  });
  it('clears a selected group after it is archived', async () => {
    render(<AddExpenseScreen />);

    fireEvent.change(screen.getByLabelText('Expense amount'), {
      target: { value: '100' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Choose group' }));
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Archive selected group' })
      );
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save expense' }));

    expect(mocks.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        values: expect.objectContaining({ groupId: null }),
      }),
      expect.any(Object)
    );
  });

  it('rejects save when the selected branch is no longer active', () => {
    mocks.branchScope = { type: 'all' };
    mocks.branches = [
      {
        active: false,
        id: '8b3f1444-8890-4b6a-a00f-ae80949f05b2',
        is_default: false,
        name: 'Former Lagos',
      },
    ];

    render(<AddExpenseScreen />);

    fireEvent.change(screen.getByLabelText('Expense amount'), {
      target: { value: '100' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save expense' }));

    expect(mocks.alert).toHaveBeenCalledWith(
      'Branch unavailable',
      'Choose an active branch before saving.'
    );
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it('rejects save when the selected group is no longer active', () => {
    mocks.branchScope = { type: 'all' };
    mocks.branches = [
      {
        active: true,
        id: branchId,
        is_default: true,
        name: 'Lagos main',
      },
    ];
    mocks.groups = [
      {
        archived_at: null,
        created_at: '2026-08-01T00:00:00.000Z',
        id: groupId,
        merchant_id: merchantId,
        name: 'Marketing',
        updated_at: '2026-08-01T00:00:00.000Z',
      },
    ];

    const view = render(<AddExpenseScreen />);
    fireEvent.change(screen.getByLabelText('Expense amount'), {
      target: { value: '100' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Choose group' }));

    mocks.groups = [
      {
        archived_at: '2026-08-10T00:00:00.000Z',
        created_at: '2026-08-01T00:00:00.000Z',
        id: groupId,
        merchant_id: merchantId,
        name: 'Marketing',
        updated_at: '2026-08-10T00:00:00.000Z',
      },
    ];
    view.rerender(<AddExpenseScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Save expense' }));

    expect(mocks.alert).toHaveBeenCalledWith(
      'Group unavailable',
      'Choose an active group before saving.'
    );
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it('keeps the create form usable when a branch refetch fails with cached data', () => {
    mocks.branchesError = new Error('branches refetch failed');

    render(<AddExpenseScreen />);

    expect(
      screen.queryByText('Could not load branches. Please try again.')
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save expense' })).toBeEnabled();
  });
});
