import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { Text } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  queryCalls: [] as Array<{ args: unknown[]; method: string }>,
  queryState: { data: [], error: null, isError: false, isLoading: false } as {
    data?: unknown[];
    error: Error | null;
    isError: boolean;
    isLoading: boolean;
  },
}));
const MERCHANT_ID = 'cae013e3-719e-4baa-9ab9-45d080ce23ea';
function makeExpense(overrides: Record<string, unknown> = {}) {
  return {
    amount: 12_500,
    branch_id: null,
    category: 'Travel',
    created_by_user_id: null,
    date: '2026-07-31',
    description: 'Taxi',
    group_id: null,
    id: 'expense-1',
    merchant_id: MERCHANT_ID,
    payment_method: null,
    receipt_storage_path: null,
    receipt_url: null,
    reference: null,
    updated_at: '2026-07-31T12:00:00.000Z',
    updated_by_user_id: null,
    vendor_name: null,
    ...overrides,
  };
}
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
  // biome-ignore lint/suspicious/noThenProperty: The Supabase query builder awaited by this component is thenable.
  chain.then = (
    resolve: (value: {
      data: unknown[] | null;
      error: Error | null;
    }) => unknown,
    reject?: (reason?: unknown) => unknown
  ) =>
    Promise.resolve({ data: mocks.queryState.data ?? [], error: null }).then(
      resolve,
      reject
    );
  return chain;
}
vi.mock('@tanstack/react-query', () => ({
  useQuery: ({
    enabled = true,
    queryFn,
  }: {
    enabled?: boolean;
    queryFn: () => Promise<unknown>;
  }) => {
    if (enabled) void queryFn();
    return mocks.queryState;
  },
}));
vi.mock('@/hooks/useMerchant', () => ({
  useMerchant: () => ({
    merchant: {
      id: 'cae013e3-719e-4baa-9ab9-45d080ce23ea',
      payout_currency: 'NGN',
    },
  }),
}));
vi.mock('@/hooks/useBranchScope', () => ({
  useBranchScope: () => ({ scope: { type: 'all' } }),
}));
vi.mock('@/hooks/useBranches', () => ({
  useBranches: () => ({ data: [], refetch: vi.fn() }),
}));
vi.mock('@/hooks/useExpenseGroups', () => ({
  useExpenseGroups: () => ({
    allGroups: [],
    error: null,
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
vi.mock('@/components/expenses/ExpenseListItem', () => ({
  ExpenseListItem: ({ canEdit }: { canEdit: boolean }) => (
    <Text>{canEdit ? 'editable expense row' : 'view-only expense row'}</Text>
  ),
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
      aria-label="Apply ungrouped filter"
      onClick={() =>
        onApply({
          branchId: 'all',
          category: 'all',
          datePreset: 'all',
          endDate: null,
          groupId: 'ungrouped',
          startDate: null,
        })
      }
      type="button"
    >
      Apply ungrouped
    </button>
  ),
}));
vi.mock('@shopify/flash-list', async () => {
  const React = await import('react');
  return {
    FlashList: ({
      data = [],
      ListEmptyComponent,
      renderItem,
    }: {
      data?: Array<{ key: string }>;
      ListEmptyComponent?: ComponentType | ReactNode;
      renderItem: (input: {
        index: number;
        item: { key: string };
      }) => ReactNode;
    }) =>
      data.length === 0 ? (
        React.isValidElement(ListEmptyComponent) ? (
          ListEmptyComponent
        ) : null
      ) : (
        <section>
          {data.map((item, index) => (
            <div key={item.key}>{renderItem({ item, index })}</div>
          ))}
        </section>
      ),
  };
});
vi.mock('expo-router', () => ({
  Stack: { Screen: () => null },
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

import { ExpenseListContent } from './ExpenseListContent';

describe('ExpenseListContent', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    mocks.queryCalls.length = 0;
    mocks.queryState = {
      data: [makeExpense()],
      error: null,
      isError: false,
      isLoading: false,
    };
  });

  it('queries ungrouped expenses server-side and shows a matching visible total with a singular month count', () => {
    render(<ExpenseListContent canCreate canEdit />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Open expense filters' })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Apply ungrouped filter' })
    );

    expect(mocks.queryCalls).toContainEqual({
      args: ['group_id', null],
      method: 'is',
    });
    expect(screen.getByText('Filtered total')).toBeInTheDocument();
    expect(screen.getByText('Travel')).toBeInTheDocument();
    expect(screen.getAllByText('1 expense')).toHaveLength(2);
    expect(screen.getAllByText(/12,500/)).toHaveLength(3);
  });

  it('forwards edit access to each visible expense row', () => {
    const { unmount } = render(<ExpenseListContent canCreate canEdit />);

    expect(screen.getByText('editable expense row')).toBeInTheDocument();
    expect(screen.queryByText('view-only expense row')).not.toBeInTheDocument();

    unmount();
    render(<ExpenseListContent canCreate canEdit={false} />);

    expect(screen.getByText('view-only expense row')).toBeInTheDocument();
    expect(screen.queryByText('editable expense row')).not.toBeInTheDocument();
  });

  it('describes an empty current-month result as a period with no expenses', () => {
    mocks.queryState.data = [];
    render(<ExpenseListContent canCreate canEdit={false} />);

    expect(
      screen.getByText('No expenses recorded in this period')
    ).toBeInTheDocument();
    expect(
      screen.queryByText('No expenses recorded yet')
    ).not.toBeInTheDocument();
  });

  it('uses the Lagos current month query range and sums the returned rows at a UTC month boundary', () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      calendar: 'gregory',
      locale: 'en-NG',
      numberingSystem: 'latn',
      timeZone: 'Africa/Lagos',
    });
    vi.useFakeTimers({ now: new Date('2026-07-31T23:30:00.000Z') });

    render(<ExpenseListContent canCreate canEdit={false} />);

    expect(mocks.queryCalls).toContainEqual({
      args: ['date', '2026-08-01'],
      method: 'gte',
    });
    expect(mocks.queryCalls).toContainEqual({
      args: ['date', '2026-08-31'],
      method: 'lte',
    });
    expect(screen.getByText('Total this Month')).toBeInTheDocument();
    expect(screen.getAllByText(/12,500/)).toHaveLength(3);
  });
});
