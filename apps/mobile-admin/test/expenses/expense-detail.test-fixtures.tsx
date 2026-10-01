import type { ReactNode } from 'react';
import { vi } from 'vitest';
import type { ExpenseDetail } from '@/components/expenses/types';
import type { ExpenseGroup } from '@/schemas/expense-group';

// Kept outside app/ so Expo Router never bundles Vitest-only helpers as routes.

export const detailExpenseId = '6d89c8af-7bef-4b78-a7b5-9c2a63f691e9';

export const detailExpenseFixture = (): ExpenseDetail => ({
  amount: 12500,
  branch_id: 'branch-1',
  category: 'Inventory',
  created_by_user_id: null,
  date: '2026-05-05T00:00:00.000Z',
  description: 'Office internet',
  group_id: null,
  id: detailExpenseId,
  merchant_id: '97e7a9a4-4f82-484d-a0a5-0f2ba07f4e2e',
  payment_method: null,
  receipt_storage_path: null,
  receipt_url: null,
  reference: null,
  updated_at: '2026-05-05T00:00:00.000Z',
  updated_by_user_id: null,
  vendor_name: null,
});

const detailMocks = vi.hoisted(() => ({
  accessError: null as Error | null,
  accessLoading: false,
  branchEqCalls: [] as unknown[][],
  branchHookCalls: 0,
  branchMaybeSingleCalls: 0,
  branchQueryOptions: null as {
    enabled?: boolean;
    queryKey: readonly unknown[];
  } | null,
  branchScope: { branchId: 'branch-1', type: 'branch' } as
    | { type: 'all' }
    | { type: 'branch'; branchId: string },
  branchSelectCalls: [] as unknown[][],
  branches: [{ id: 'branch-1', name: 'Lagos main' }],
  branchesLoading: false,
  canEdit: true,
  canView: true,
  eqCalls: [] as unknown[][],
  expenseResult: {
    data: null as ExpenseDetail | null,
    error: null as Error | null,
  },
  groupHookCalls: 0,
  groups: [] as ExpenseGroup[],
  groupsLoading: false,
  groupsError: false,
  historicalBranchResult: {
    data: { id: 'branch-1', name: 'Lagos main' } as {
      id: string;
      name: string;
    } | null,
    error: null as Error | null,
  },
  linking: { canOpenURL: vi.fn(), openURL: vi.fn() },
  maybeSingleCalls: 0,
  queryOptions: null as {
    enabled?: boolean;
    queryKey: readonly unknown[];
  } | null,
  queryState: null as {
    data?: unknown;
    error?: Error | null;
    isError?: boolean;
    isLoading: boolean;
  } | null,
  receiptHookCalls: 0,
  receiptUrl: null as string | null,
  router: { push: vi.fn() },
  selectCalls: [] as unknown[][],
  singleCalls: 0,
}));

export function getExpenseDetailMocks() {
  return detailMocks;
}

function makeExpenseQuery() {
  const chain: Record<string, unknown> = {};
  chain.select = (...args: unknown[]) => {
    detailMocks.selectCalls.push(args);
    return chain;
  };
  chain.eq = (...args: unknown[]) => {
    detailMocks.eqCalls.push(args);
    return chain;
  };
  chain.maybeSingle = () => {
    detailMocks.maybeSingleCalls += 1;
    return Promise.resolve(detailMocks.expenseResult);
  };
  chain.single = () => {
    detailMocks.singleCalls += 1;
    return Promise.resolve({
      data: null,
      error: new Error('unexpected single'),
    });
  };
  return chain;
}

function makeHistoricalBranchQuery() {
  const chain: Record<string, unknown> = {};
  chain.select = (...args: unknown[]) => {
    detailMocks.branchSelectCalls.push(args);
    return chain;
  };
  chain.eq = (...args: unknown[]) => {
    detailMocks.branchEqCalls.push(args);
    return chain;
  };
  chain.maybeSingle = () => {
    detailMocks.branchMaybeSingleCalls += 1;
    return Promise.resolve(detailMocks.historicalBranchResult);
  };
  return chain;
}

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({
    enabled,
    queryFn,
    queryKey,
  }: {
    enabled?: boolean;
    queryFn: () => Promise<unknown>;
    queryKey: readonly unknown[];
  }) => {
    if (queryKey[0] === 'expense-branch') {
      detailMocks.branchQueryOptions = { enabled, queryKey };
      if (enabled) void queryFn().catch(() => undefined);
      return {
        data: enabled ? detailMocks.historicalBranchResult.data : undefined,
        isLoading: false,
      };
    }
    detailMocks.queryOptions = { enabled, queryKey };
    if (detailMocks.queryState) return detailMocks.queryState;
    void queryFn().catch(() => undefined);
    return { data: detailMocks.expenseResult.data, isLoading: false };
  },
}));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) =>
      table === 'branches' ? makeHistoricalBranchQuery() : makeExpenseQuery(),
  },
}));
vi.mock('@/hooks/useBranches', () => ({
  useBranches: () => {
    detailMocks.branchHookCalls += 1;
    return {
      data: detailMocks.branches,
      isLoading: detailMocks.branchesLoading,
    };
  },
}));
vi.mock('@/hooks/useBranchScope', () => ({
  useBranchScope: () => ({ scope: detailMocks.branchScope }),
}));
vi.mock('@/hooks/useExpenseAccess', () => ({
  useExpenseAccess: () => ({
    canEdit: detailMocks.canEdit,
    canView: detailMocks.canView,
    error: detailMocks.accessError,
    isLoading: detailMocks.accessLoading,
  }),
}));
vi.mock('@/hooks/useExpenseGroups', () => ({
  useExpenseGroups: () => {
    detailMocks.groupHookCalls += 1;
    return {
      allGroups: detailMocks.groups,
      isLoading: detailMocks.groupsLoading,
      isError: detailMocks.groupsError,
    };
  },
}));
vi.mock('@/hooks/useExpenseReceiptUrl', () => ({
  useExpenseReceiptUrl: () => {
    detailMocks.receiptHookCalls += 1;
    return { error: null, isLoading: false, url: detailMocks.receiptUrl };
  },
}));
vi.mock('@/hooks/useMerchant', () => ({
  useMerchant: () => ({
    merchant: { id: 'merchant-1', payout_currency: 'NGN' },
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
      textSecondary: '#cbd5e1',
    },
    isDark: true,
    shadows: { sm: {} },
  }),
}));
vi.mock('expo-router', () => ({
  Stack: {
    Screen: ({ options }: { options?: { headerRight?: () => ReactNode } }) => (
      <>{options?.headerRight?.()}</>
    ),
  },
  useLocalSearchParams: () => ({ id: detailExpenseId }),
  useRouter: () => detailMocks.router,
}));
vi.mock('@react-native-vector-icons/ionicons', () => ({
  default: () => <span>icon</span>,
}));
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock('react-native', () => ({
  Alert: { alert: vi.fn() },
  Linking: detailMocks.linking,
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
  ScrollView: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  StatusBar: () => null,
  StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

export function resetExpenseDetailMocks() {
  vi.clearAllMocks();
  detailMocks.accessError = null;
  detailMocks.accessLoading = false;
  detailMocks.branchEqCalls.length = 0;
  detailMocks.branchHookCalls = 0;
  detailMocks.branchMaybeSingleCalls = 0;
  detailMocks.branchQueryOptions = null;
  detailMocks.branchScope = { branchId: 'branch-1', type: 'branch' };
  detailMocks.branchSelectCalls.length = 0;
  detailMocks.branches = [{ id: 'branch-1', name: 'Lagos main' }];
  detailMocks.branchesLoading = false;
  detailMocks.canEdit = true;
  detailMocks.canView = true;
  detailMocks.eqCalls.length = 0;
  detailMocks.expenseResult = { data: detailExpenseFixture(), error: null };
  detailMocks.groupHookCalls = 0;
  detailMocks.groups = [];
  detailMocks.groupsError = false;
  detailMocks.groupsLoading = false;
  detailMocks.historicalBranchResult = {
    data: { id: 'branch-1', name: 'Lagos main' },
    error: null,
  };
  detailMocks.linking.canOpenURL.mockResolvedValue(true);
  detailMocks.linking.openURL.mockResolvedValue(undefined);
  detailMocks.maybeSingleCalls = 0;
  detailMocks.queryOptions = null;
  detailMocks.queryState = null;
  detailMocks.receiptHookCalls = 0;
  detailMocks.receiptUrl = null;
  detailMocks.selectCalls.length = 0;
  detailMocks.singleCalls = 0;
}
