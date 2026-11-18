import '@testing-library/jest-dom/vitest';
import type { ReactNode } from 'react';
import { vi } from 'vitest';

type QueryConfig = {
  queryFn: () => Promise<unknown>;
};

type MutationVariables = {
  field: string;
  merchantId: string;
  settingsId: string;
  value: boolean;
};

type MutationContext = {
  merchantId?: string;
  previousSettings?: unknown;
};

type MutationConfig = {
  mutationFn: (variables: MutationVariables) => Promise<void>;
  onMutate?: (
    variables: MutationVariables
  ) => Promise<MutationContext | undefined>;
  onError?: (
    error: Error,
    variables: unknown,
    context?: MutationContext
  ) => void;
  onSuccess?: (
    data: unknown,
    variables: unknown,
    context?: MutationContext
  ) => Promise<void>;
  onSettled?: (
    data: unknown,
    error: Error | null,
    variables: unknown,
    context?: MutationContext
  ) => Promise<void> | void;
};

interface MockUseMerchantResult {
  isLoading: boolean;
  merchant: { id: string } | null;
  error: Error | null;
}

const hoistedMocks = vi.hoisted(() => ({
  alert: vi.fn(),
  eq: vi.fn(),
  from: vi.fn(),
  getQueryData: vi.fn(),
  invalidateQueries: vi.fn(),
  invalidateStoreReadiness: vi.fn().mockResolvedValue(undefined),
  isPending: false,
  mutate: vi.fn(),
  mutationConfig: undefined as MutationConfig | undefined,
  openURL: vi.fn(),
  refetch: vi.fn(),
  select: vi.fn(),
  update: vi.fn(),
  setQueryData: vi.fn(),
  single: vi.fn(),
  useMerchantResult: {
    isLoading: false,
    merchant: { id: 'merchant-1' },
    error: null,
  } as MockUseMerchantResult,
  useQuery: vi.fn(),
}));

export const mocks = hoistedMocks;

vi.mock('expo-router', async () => {
  const React = await import('react');
  return {
    Stack: {
      Screen: () => React.createElement('div', null),
    },
  };
});

vi.mock('@tanstack/react-query', () => ({
  useMutation: (config: MutationConfig) => {
    mocks.mutationConfig = config;
    mocks.mutate.mockImplementation((variables: MutationVariables) => {
      void (async () => {
        const context = await config.onMutate?.(variables);
        let mutationError: Error | null = null;
        try {
          await config.mutationFn(variables);
          await config.onSuccess?.(undefined, variables, context);
        } catch (error) {
          mutationError = error as Error;
          config.onError?.(mutationError, variables, context);
        } finally {
          await config.onSettled?.(
            undefined,
            mutationError,
            variables,
            context
          );
        }
      })();
    });
    return {
      isPending: mocks.isPending,
      mutate: mocks.mutate,
    };
  },
  useQuery: (config: QueryConfig) => mocks.useQuery(config),
  useQueryClient: () => ({
    cancelQueries: vi.fn(),
    getQueryData: mocks.getQueryData,
    invalidateQueries: mocks.invalidateQueries,
    setQueryData: mocks.setQueryData,
  }),
}));

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      background: '#ffffff',
      border: '#e2e8f0',
      card: '#f8fafc',
      cardHover: '#f1f5f9',
      info: '#2563eb',
      infoLight: '#eff6ff',
      notification: '#dc2626',
      primary: '#2563eb',
      success: '#16a34a',
      successLight: '#dcfce7',
      text: '#0f172a',
      textMuted: '#64748b',
      textOnPrimary: '#ffffff',
      textSecondary: '#334155',
    },
    isDark: false,
    shadows: { sm: {} },
  }),
}));

vi.mock('@/hooks/useMerchant', () => ({
  useMerchant: () => mocks.useMerchantResult,
}));

vi.mock('@/lib/invalidate-store-readiness', () => ({
  invalidateStoreReadiness: mocks.invalidateStoreReadiness,
}));

vi.mock('@/components/ui/ScreenSkeleton', async () => {
  const { Text } = await import('react-native');
  return {
    ScreenSkeleton: () => <Text>loading</Text>,
  };
});

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: mocks.from,
  },
}));

function createMerchantFeatureSettingsQuery() {
  return {
    select: mocks.select,
    update: mocks.update,
  };
}

vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children?: ReactNode }) => (
    <section>{children}</section>
  ),
}));

vi.mock('react-native', () => ({
  StatusBar: () => null,
  Alert: { alert: mocks.alert },
  Linking: { openURL: mocks.openURL },
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
  StyleSheet: {
    create: (styles: Record<string, unknown>) => styles,
  },
  Switch: ({
    accessibilityLabel,
    disabled,
    onValueChange,
    value,
  }: {
    accessibilityLabel?: string;
    disabled?: boolean;
    onValueChange?: (value: boolean) => void;
    value?: boolean;
  }) => (
    <input
      aria-label={accessibilityLabel}
      checked={!!value}
      disabled={disabled}
      onChange={(event) => onValueChange?.(event.currentTarget.checked)}
      aria-checked={!!value}
      role="switch"
      type="checkbox"
    />
  ),
  Text: ({
    children,
    style,
  }: {
    children?: ReactNode;
    style?: Record<string, unknown> | Array<Record<string, unknown> | false>;
  }) => {
    const resolvedStyle = Array.isArray(style)
      ? Object.assign({}, ...style.filter(Boolean))
      : style;
    const color =
      typeof resolvedStyle?.color === 'string'
        ? resolvedStyle.color
        : undefined;
    return <span data-color={color}>{children}</span>;
  },
  View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@react-native-vector-icons/ionicons', async () => {
  const { Text } = await import('react-native');
  const MockIonicon = ({ color, name }: { color?: string; name?: string }) => (
    <span data-icon-color={color} data-icon-name={name}>
      <Text>icon</Text>
    </span>
  );
  return {
    Ionicons: MockIonicon,
    default: MockIonicon,
    __esModule: true,
  };
});

export const paymentSettings = {
  id: 'settings-1',
  merchant_id: 'merchant-1',
  paystack_enabled: true,
  korapay_enabled: true,
  credit_direct_enabled: false,
  credpal_enabled: false,
  pay_on_delivery_enabled: true,
  juicyway_enabled: false,
  klump_enabled: true,
};

export function resetPaymentMethodsScreenMocks() {
  mocks.alert.mockReset();
  mocks.eq.mockReset();
  mocks.from.mockReset();
  mocks.getQueryData.mockReset();
  mocks.getQueryData.mockReturnValue(paymentSettings);
  mocks.invalidateQueries.mockReset();
  mocks.invalidateStoreReadiness.mockReset();
  mocks.invalidateStoreReadiness.mockResolvedValue(undefined);
  mocks.isPending = false;
  mocks.mutate.mockReset();
  mocks.mutationConfig = undefined;
  mocks.openURL.mockReset();
  mocks.refetch.mockReset();
  mocks.select.mockReset();
  mocks.update.mockReset();
  mocks.setQueryData.mockReset();
  mocks.single.mockReset();
  mocks.useMerchantResult = {
    isLoading: false,
    merchant: { id: 'merchant-1' },
    error: null,
  };
  mocks.useQuery.mockReset();
  mocks.update.mockReset();
  mocks.single.mockResolvedValue({ data: paymentSettings, error: null });
  mocks.eq.mockImplementation((column: string) =>
    column === 'id' ? { eq: mocks.eq } : { error: null, single: mocks.single }
  );
  mocks.select.mockReturnValue({ eq: mocks.eq });
  mocks.update.mockReturnValue({ eq: mocks.eq });
  mocks.from.mockReturnValue(createMerchantFeatureSettingsQuery());
  mocks.useQuery.mockReturnValue({
    data: paymentSettings,
    error: null,
    isError: false,
    isLoading: false,
    refetch: mocks.refetch,
  });
}
