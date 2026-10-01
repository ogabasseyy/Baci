import '@testing-library/jest-dom/vitest';
import type React from 'react';
import { vi } from 'vitest';

export const THEME_TEXT = '#abcdef';
export const THEME_TEXT_ON_PRIMARY = '#fedcba';
const queryMocks = vi.hoisted(() => ({ useQuery: vi.fn() }));
const queryClientMocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  setQueryData: vi.fn(),
}));
const readinessMocks = vi.hoisted(() => ({
  invalidateStoreReadiness: vi.fn().mockResolvedValue(undefined),
}));
const accessMocks = vi.hoisted(() => ({
  useMerchant: vi.fn(),
  useRevenueCat: vi.fn(),
}));
const routeMocks = vi.hoisted(() => ({
  back: vi.fn(),
  params: {} as { from?: string },
}));
const alertMocks = vi.hoisted(() => ({ alert: vi.fn() }));
const supabaseMocks = vi.hoisted(() => {
  const eq = vi.fn(() => ({ error: null }));
  const update = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ update }));
  const rpc = vi.fn(
    async (): Promise<{ data: unknown; error: Error | null }> => ({
      data: null,
      error: null,
    })
  );
  return { eq, from, rpc, update };
});
const mutationMocks = vi.hoisted(() => {
  type MutationOptions = {
    mutationFn: (variables?: unknown) => Promise<unknown>;
    onMutate?: (variables?: unknown) => unknown | Promise<unknown>;
    onSuccess?: (
      data?: unknown,
      variables?: unknown,
      context?: unknown
    ) => Promise<void> | void;
    onError?: (
      error: unknown,
      variables?: unknown,
      context?: unknown
    ) => Promise<void> | void;
    onSettled?: (
      data: unknown,
      error: unknown,
      variables?: unknown,
      context?: unknown
    ) => Promise<void> | void;
  };
  const state: { options: MutationOptions | null } = { options: null };
  return {
    state,
    useMutation: (options: MutationOptions) => {
      state.options = options;
      return {
        isPending: false,
        mutate: (variables?: unknown) => {
          void (async () => {
            let context: unknown;
            let data: unknown = null;
            let error: unknown = null;

            try {
              context = await options.onMutate?.(variables);
              data = await options.mutationFn(variables);
              await options.onSuccess?.(data, variables, context);
            } catch (caught) {
              error = caught;
              await options.onError?.(caught, variables, context);
            } finally {
              await options.onSettled?.(data, error, variables, context);
            }
          })().catch(() => undefined);
        },
      };
    },
  };
});

vi.mock('react-native', async () => {
  const React = await import('react');
  type ViewLike = {
    children?: React.ReactNode;
    style?: unknown;
    testID?: string;
    onPress?: () => void;
    [key: string]: unknown;
  };
  const toDomStyle = (style: unknown): React.CSSProperties | undefined => {
    if (!style) return undefined;
    if (Array.isArray(style))
      return Object.assign(
        {},
        ...style
          .flat(Number.POSITIVE_INFINITY)
          .map(toDomStyle)
          .filter((value): value is React.CSSProperties => Boolean(value))
      );
    if (typeof style !== 'object') return undefined;
    const domStyle = { ...(style as React.CSSProperties) };
    if (Array.isArray(domStyle.transform)) delete domStyle.transform;
    return domStyle;
  };
  const domProps = (props: ViewLike) => ({
    'data-testid': props.testID,
    style: toDomStyle(props.style),
  });
  return {
    StatusBar: () => null,
    ActivityIndicator: () =>
      React.createElement('div', { role: 'progressbar' }),
    Alert: { alert: alertMocks.alert },
    Linking: { openURL: vi.fn() },
    Pressable: ({ children, onPress, ...rest }: ViewLike) =>
      React.createElement(
        'button',
        { type: 'button', onClick: () => onPress?.(), ...domProps(rest) },
        children
      ),
    ScrollView: ({ children, ...rest }: ViewLike) =>
      React.createElement('div', domProps(rest), children),
    StyleSheet: { create: <T,>(styles: T) => styles },
    Text: ({ children, ...rest }: ViewLike) =>
      React.createElement('span', domProps(rest), children),
    TextInput: ({
      value,
      placeholder,
      onChangeText,
      ...rest
    }: ViewLike & {
      value?: string;
      placeholder?: string;
      onChangeText?: (text: string) => void;
    }) =>
      React.createElement('input', {
        ...domProps(rest),
        placeholder,
        value: value ?? '',
        onChange: (event: { target: { value: string } }) =>
          onChangeText?.(event.target.value),
      }),
    View: ({ children, ...rest }: ViewLike) =>
      React.createElement('div', domProps(rest), children),
  };
});
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock('@react-native-vector-icons/ionicons', async () => {
  const React = await import('react');
  const Icon = ({ name, color }: { name: string; color: string }) =>
    React.createElement('i', {
      'data-testid': `icon-${name}`,
      'data-color': color,
    });
  return { Ionicons: Icon, default: Icon, __esModule: true };
});
vi.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => routeMocks.params,
  useRouter: () => ({ back: routeMocks.back, push: vi.fn() }),
}));
vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      background: '#000',
      border: '#222',
      card: '#111',
      gold: '#b45309',
      goldLight: '#fef3c7',
      primary: '#3b82f6',
      text: THEME_TEXT,
      textMuted: '#888',
      textOnPrimary: THEME_TEXT_ON_PRIMARY,
      textSecondary: '#aaa',
    },
    shadows: { sm: {} },
  }),
}));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));
vi.mock('@/hooks/useMerchant', () => ({
  useMerchant: accessMocks.useMerchant,
}));
vi.mock('@/hooks/useRevenueCat', () => ({
  useRevenueCat: accessMocks.useRevenueCat,
}));
vi.mock('@/lib/supabase', () => ({
  supabase: { from: supabaseMocks.from, rpc: supabaseMocks.rpc },
}));
vi.mock('@/lib/invalidate-store-readiness', () => ({
  invalidateStoreReadiness: readinessMocks.invalidateStoreReadiness,
}));
vi.mock('@/components/ui/ScreenSkeleton', () => ({
  ScreenSkeleton: () => null,
}));
vi.mock('@tanstack/react-query', () => ({
  useMutation: mutationMocks.useMutation,
  useQuery: queryMocks.useQuery,
  useQueryClient: () => queryClientMocks,
}));

const { default: AnalyticsConfigScreen } = await import(
  '../../app/(admin)/analytics-config'
);

export const merchantAnalytics = {
  facebook_capi_token: '',
  facebook_pixel_id: '',
  ga4_api_secret: '',
  google_analytics_id: '',
  offline_conversions_enabled: true,
  snapchat_capi_token: '',
  snapchat_pixel_id: '',
  tiktok_access_token: '',
  tiktok_pixel_id: '',
};
export function resetAnalyticsConfigMocks() {
  vi.clearAllMocks();
  supabaseMocks.eq.mockImplementation(() => ({ error: null }));
  supabaseMocks.update.mockImplementation(() => ({
    eq: supabaseMocks.eq,
  }));
  supabaseMocks.from.mockImplementation(() => ({
    update: supabaseMocks.update,
  }));
  supabaseMocks.rpc.mockImplementation(async () => ({
    data: null,
    error: null,
  }));
  mutationMocks.state.options = null;
  routeMocks.back.mockReset();
  routeMocks.params = {};
  accessMocks.useMerchant.mockReturnValue({
    isLoading: false,
    merchant: { id: 'merchant-1', plan_tier: 'pro', premium_features: [] },
  });
  accessMocks.useRevenueCat.mockReturnValue({ isPro: true });
  queryMocks.useQuery.mockReturnValue({
    data: { analytics: { ...merchantAnalytics }, isOwner: true },
    isError: false,
    isLoading: false,
  });
}
export {
  AnalyticsConfigScreen,
  accessMocks,
  alertMocks,
  mutationMocks,
  queryClientMocks,
  queryMocks,
  readinessMocks,
  routeMocks,
  supabaseMocks,
};
