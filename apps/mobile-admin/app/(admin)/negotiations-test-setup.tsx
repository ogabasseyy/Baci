vi.mock('expo-router', () => ({ useIsFocused: () => true }));

import '@testing-library/jest-dom/vitest';
import { type ReactNode, useState } from 'react';
import { beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  channelOn: vi.fn(),
  channelSubscribe: vi.fn(),
  canOpenURL: vi.fn().mockResolvedValue(true),
  createSignedUrl: vi.fn().mockResolvedValue({
    data: { signedUrl: 'https://signed.example/evidence.png' },
    error: null,
  }),
  merchant: { id: 'merchant-1' } as { id?: string } | null,
  notificationAsync: vi.fn().mockResolvedValue(undefined),
  openURL: vi.fn().mockResolvedValue(undefined),
  queryCalls: [] as Array<{ method: string; args: unknown[] }>,
  removeChannel: vi.fn(),
  selectResult: null as QueryResult | null,
  updateResult: null as QueryResult | null,
}));

type QueryResult = {
  data: unknown[] | null;
  error: Error | null;
};

export const negotiationRows = [
  {
    created_at: '2026-06-05T12:00:00.000Z',
    customer_id: null,
    customer_email: null,
    evidence_url: null,
    id: 'negotiation-1',
    item_info: { name: 'Wireless Headphones', current_price: 10_000 },
    offered_price: 8_500,
    status: 'pending',
    type: 'single',
  },
];

function makeQueryChain() {
  const chain: Record<string, unknown> = {};
  let isMutation = false;
  const passthrough =
    (method: string) =>
    (...args: unknown[]) => {
      if (method === 'update') {
        isMutation = true;
      }
      mocks.queryCalls.push({ method, args });
      return chain;
    };

  for (const method of ['select', 'order', 'update', 'eq']) {
    chain[method] = passthrough(method);
  }

  // biome-ignore lint/suspicious/noThenProperty: Supabase query builders are thenable, so the mock must be too.
  chain.then = (
    resolve: (value: QueryResult) => unknown,
    reject?: (reason?: unknown) => unknown
  ) =>
    Promise.resolve(
      isMutation
        ? (mocks.updateResult ?? { data: null, error: null })
        : (mocks.selectResult ?? { data: negotiationRows, error: null })
    ).then(resolve, reject);

  return chain;
}

vi.mock('@/hooks/useMerchant', () => ({
  useMerchant: () => ({ merchant: mocks.merchant, isLoading: false }),
}));

vi.mock('@tanstack/react-query', () => {
  return {
    useQueryClient: () => ({
      invalidateQueries: () => {
        mocks.queryCalls.push({
          method: 'select',
          args: [
            'id, customer_id, type, status, offered_price, item_info, cart_snapshot, customer_email, customer_phone, created_at, evidence_url',
          ],
        });
        mocks.queryCalls.push({
          method: 'eq',
          args: ['merchant_id', mocks.merchant?.id],
        });
      },
    }),
    useQuery: (options: { queryKey: unknown[]; enabled?: boolean }) => {
      const enabled = options.enabled ?? true;
      if (options.queryKey[0] === 'negotiation_requests') {
        const selectResult = mocks.selectResult ?? {
          data: negotiationRows,
          error: null,
        };
        const dataRows = (selectResult.data ?? []) as Array<{
          cart_snapshot?: unknown;
          item_info?: { current_price?: number };
        }>;
        const formattedData = dataRows.map((row) => ({
          ...row,
          cart_snapshot: Array.isArray(row.cart_snapshot)
            ? row.cart_snapshot
            : null,
          current_price: row.item_info?.current_price ?? null,
        }));
        return {
          data: enabled ? formattedData : [],
          isLoading: false,
          error: selectResult.error,
          refetch: vi.fn().mockImplementation(() => {
            mocks.queryCalls.push({
              method: 'select',
              args: [
                'id, customer_id, type, status, offered_price, item_info, cart_snapshot, customer_email, customer_phone, created_at, evidence_url',
              ],
            });
            mocks.queryCalls.push({
              method: 'eq',
              args: ['merchant_id', mocks.merchant?.id],
            });
            return selectResult;
          }),
        };
      }
      return { data: null, isLoading: false, error: null, refetch: vi.fn() };
    },
    useMutation: <TVariables = unknown, TData = unknown>({
      mutationFn,
      onSuccess,
      onError,
    }: {
      mutationFn: (variables: TVariables) => Promise<TData>;
      onSuccess?: (data: TData, variables: TVariables) => void;
      onError?: (error: unknown, variables: TVariables) => void;
    }) => {
      const [isPending, setIsPending] = useState(false);
      const [variables, setVariables] = useState<TVariables | null>(null);
      return {
        isPending,
        variables,
        mutate: async (vars: TVariables) => {
          setIsPending(true);
          setVariables(vars);
          try {
            const res = await mutationFn(vars);
            onSuccess?.(res, vars);
            return res;
          } catch (err) {
            onError?.(err, vars);
          } finally {
            setIsPending(false);
            setVariables(null);
          }
        },
      };
    },
  };
});

vi.mock('@/lib/api-client', () => ({
  apiClient: vi.fn().mockResolvedValue({
    notified: true,
    status: 'accepted',
  }),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    channel: vi.fn(() => ({
      on: (...args: unknown[]) => {
        mocks.channelOn(...args);
        return { subscribe: mocks.channelSubscribe };
      },
    })),
    from: vi.fn(() => makeQueryChain()),
    removeChannel: (...args: unknown[]) => mocks.removeChannel(...args),
    storage: {
      from: vi.fn(() => ({
        createSignedUrl: (...args: unknown[]) => mocks.createSignedUrl(...args),
      })),
    },
  },
}));

vi.mock('expo-crypto', () => import('node:crypto'));

vi.mock('expo-haptics', () => ({
  NotificationFeedbackType: { Error: 'error', Success: 'success' },
  notificationAsync: (...args: unknown[]) => mocks.notificationAsync(...args),
}));

vi.mock('@react-native-vector-icons/ionicons', async () => {
  const { Text } = await import('react-native');
  return {
    Ionicons: () => <Text>icon</Text>,
    default: () => <Text>icon</Text>,
    __esModule: true,
  };
});

vi.mock('@shopify/flash-list', () => ({
  FlashList: ({
    data = [],
    keyExtractor,
    renderItem,
  }: {
    data?: unknown[];
    keyExtractor?: (item: unknown, index: number) => string;
    renderItem: (input: { index: number; item: unknown }) => ReactNode;
  }) => (
    <ul aria-label="negotiation-list">
      {data.map((item, index) => (
        <li key={keyExtractor?.(item, index) ?? index}>
          {renderItem({ item, index })}
        </li>
      ))}
    </ul>
  ),
}));

vi.mock('react-native', () => {
  const MockText = ({ children }: { children?: ReactNode }) => (
    <span>{children}</span>
  );

  return {
    ActivityIndicator: () => <MockText>loading</MockText>,
    Alert: { alert: vi.fn() },
    Dimensions: { get: () => ({ height: 844, width: 390 }) },
    Linking: {
      canOpenURL: (...args: unknown[]) => mocks.canOpenURL(...args),
      openURL: (...args: unknown[]) => mocks.openURL(...args),
    },
    Pressable: ({
      children,
      disabled,
      onPress,
      accessibilityLabel,
    }: {
      accessibilityLabel?: string;
      children?: ReactNode;
      disabled?: boolean;
      onPress?: () => void;
    }) => (
      <button
        aria-label={accessibilityLabel}
        disabled={disabled}
        onClick={() => onPress?.()}
        type="button"
      >
        {children}
      </button>
    ),
    RefreshControl: () => null,
    StyleSheet: { create: <T,>(styles: T) => styles },
    Text: MockText,
    View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    useColorScheme: () => 'light',
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.canOpenURL.mockResolvedValue(true);
  mocks.createSignedUrl.mockResolvedValue({
    data: { signedUrl: 'https://signed.example/evidence.png' },
    error: null,
  });
  mocks.merchant = { id: 'merchant-1' };
  mocks.queryCalls.length = 0;
  mocks.selectResult = { data: negotiationRows, error: null };
  // Default: the update affected one still-pending row (success path).
  mocks.updateResult = { data: [{ id: 'negotiation-1' }], error: null };
});

export { mocks };
