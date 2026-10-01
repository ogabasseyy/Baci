import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { Text } from 'react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Access = {
  canCreate: boolean;
  canEdit: boolean;
  canView: boolean;
  error: Error | null;
  isLoading: boolean;
};

const activeAccess: Access = {
  canCreate: true,
  canEdit: true,
  canView: true,
  error: null,
  isLoading: false,
};

const mocks = vi.hoisted(() => ({
  access: {
    canCreate: true,
    canEdit: true,
    canView: true,
    error: null,
    isLoading: false,
  } as Access,
  queryCalls: [] as Array<{ args: unknown[]; method: string }>,
  queryKeys: [] as unknown[][],
  queryState: { data: [], error: null, isError: false, isLoading: false } as {
    data?: unknown[];
    error: Error | null;
    isError: boolean;
    isLoading: boolean;
  },
  stackOptions: null as Record<string, unknown> | null,
}));

function makeQueryChain() {
  const chain: Record<string, unknown> = {};
  const passthrough =
    (method: string) =>
    (...args: unknown[]) => {
      mocks.queryCalls.push({ args, method });
      return chain;
    };

  for (const method of ['select', 'eq', 'gte', 'is', 'lte', 'order']) {
    chain[method] = passthrough(method);
  }
  // biome-ignore lint/suspicious/noThenProperty: Supabase query builders are thenable and the screen awaits this mock.
  chain.then = (
    resolve: (value: { data: unknown[]; error: null }) => unknown
  ) => Promise.resolve({ data: [], error: null }).then(resolve);
  return chain;
}

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({
    enabled = true,
    queryFn,
    queryKey,
  }: {
    enabled?: boolean;
    queryFn: () => Promise<unknown>;
    queryKey: unknown[];
  }) => {
    mocks.queryKeys.push(queryKey);
    if (enabled) void queryFn();
    return mocks.queryState;
  },
}));

vi.mock('@/hooks/useExpenseAccess', () => ({
  useExpenseAccess: () => mocks.access,
}));
vi.mock('@/hooks/useMerchant', () => ({
  useMerchant: () => ({
    merchant: { id: 'merchant-1', payout_currency: 'NGN' },
  }),
}));
vi.mock('@/hooks/useBranchScope', () => ({
  useBranchScope: () => ({ scope: { type: 'all' } }),
}));
vi.mock('@/hooks/useBranches', () => ({ useBranches: () => ({ data: [] }) }));
vi.mock('@/hooks/useExpenseGroups', () => ({
  useExpenseGroups: () => ({
    allGroups: [],
    error: null,
    isLoading: false,
    refetch: vi.fn(),
  }),
}));
vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      background: '#020617',
      border: '#334155',
      card: '#111827',
      primary: '#3b82f6',
      text: '#f8fafc',
      textMuted: '#94a3b8',
      textOnPrimary: '#ffffff',
      textSecondary: '#cbd5e1',
    },
    isDark: true,
    shadows: { lg: {}, md: {} },
  }),
}));
vi.mock('@/lib/supabase', () => ({
  supabase: { from: () => makeQueryChain() },
}));
vi.mock('@/components/expenses/ExpenseFilterBar', () => ({
  ExpenseFilterBar: ({ onOpen }: { onOpen: () => void }) => (
    <button aria-label="Open expense filters" onClick={onOpen} type="button">
      Filters
    </button>
  ),
}));
vi.mock('@/components/expenses/ExpenseFiltersSheet', () => ({
  ExpenseFiltersSheet: ({
    onApply,
  }: {
    onApply: (filters: unknown) => void;
  }) => (
    <button
      aria-label="Apply a group filter"
      onClick={() =>
        onApply({
          branchId: 'branch-2',
          category: 'Travel',
          datePreset: 'custom',
          endDate: '2026-08-09',
          groupId: '9ba1db37-69b5-4445-8a28-e90794b1841d',
          startDate: '2026-08-03',
        })
      }
      type="button"
    >
      Apply group filter
    </button>
  ),
}));
vi.mock('@shopify/flash-list', async () => {
  return {
    FlashList: ({
      data = [],
      ListEmptyComponent,
    }: {
      data?: Array<{ key: string }>;
      ListEmptyComponent?: ReactNode;
    }) => (data.length === 0 ? ListEmptyComponent : <section />),
  };
});
vi.mock('expo-router', () => ({
  Stack: {
    Screen: ({ options }: { options: Record<string, unknown> }) => {
      mocks.stackOptions = options;
      return null;
    },
  },
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}));
vi.mock('@react-native-vector-icons/ionicons', () => ({
  default: () => <Text>icon</Text>,
  __esModule: true,
}));
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock('@/components/ui/ScreenSkeleton', () => ({
  ScreenSkeleton: () => <Text>loading</Text>,
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
  StatusBar: () => null,
  StyleSheet: { create: (styles: Record<string, unknown>) => styles },
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

import ExpensesScreen from './index';

describe('ExpensesScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.access = { ...activeAccess };
    mocks.queryCalls.length = 0;
    mocks.queryKeys.length = 0;
    mocks.queryState = {
      data: [],
      error: null,
      isError: false,
      isLoading: false,
    };
    mocks.stackOptions = null;
  });

  it('fails closed before expense, group, or branch queries when viewing is denied', () => {
    mocks.access = {
      canCreate: false,
      canEdit: false,
      canView: false,
      error: null,
      isLoading: false,
    };

    render(<ExpensesScreen />);

    expect(mocks.queryCalls).toEqual([]);
    expect(
      screen.getByText('You do not have permission to view expenses')
    ).toBeInTheDocument();
  });

  it('renders a load error when the expense query fails', () => {
    mocks.queryState = {
      data: undefined,
      error: new Error('Network unavailable'),
      isError: true,
      isLoading: false,
    };
    render(<ExpensesScreen />);
    expect(screen.getByText('Could not load expenses')).toBeInTheDocument();
  });

  it('applies normalized date, category, branch, and UUID group constraints before awaiting the query', () => {
    render(<ExpensesScreen />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Open expense filters' })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Apply a group filter' })
    );

    expect(mocks.queryCalls).toEqual(
      expect.arrayContaining([
        { args: ['date', '2026-08-03'], method: 'gte' },
        { args: ['date', '2026-08-09'], method: 'lte' },
        { args: ['category', 'Travel'], method: 'eq' },
        { args: ['branch_id', 'branch-2'], method: 'eq' },
        {
          args: ['group_id', '9ba1db37-69b5-4445-8a28-e90794b1841d'],
          method: 'eq',
        },
      ])
    );
    expect(
      mocks.queryCalls.find((call) => call.method === 'select')?.args[0]
    ).toContain('group_id');
    expect(mocks.queryKeys.at(-1)).toEqual(
      expect.arrayContaining(['expenses', 'merchant-1'])
    );
    expect(screen.getByText('Filtered total')).toBeInTheDocument();
  });

  it('hides both creation controls without create access', () => {
    mocks.access = { ...activeAccess, canCreate: false };

    render(<ExpensesScreen />);

    expect(mocks.stackOptions).not.toBeNull();
    expect(
      screen.queryByText('Add your first expense')
    ).not.toBeInTheDocument();
    expect(mocks.stackOptions?.headerRight).toBeUndefined();
  });

  it('distinguishes no matching results from a merchant with no recorded expenses', () => {
    render(<ExpensesScreen />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Open expense filters' })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Apply a group filter' })
    );

    expect(
      screen.getByText('No expenses match these filters')
    ).toBeInTheDocument();
    expect(
      screen.queryByText('No expenses recorded yet')
    ).not.toBeInTheDocument();
  });
});
