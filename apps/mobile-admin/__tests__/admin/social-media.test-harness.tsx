import '@testing-library/jest-dom/vitest';
import { cleanup, render } from '@testing-library/react';
import type React from 'react';
import { vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  alert: vi.fn(),
  back: vi.fn(),
  invalidateStoreReadiness: vi.fn().mockResolvedValue(undefined),
  invalidateQueries: vi.fn(),
  lastMutation: null as Promise<void> | null,
  routeParams: {} as { from?: string },
  updateMerchantSettings: vi.fn(),
  useMerchant: vi.fn(),
  useMutation: vi.fn(),
}));

type MutationOptions = {
  mutationFn: (variables?: unknown) => Promise<unknown>;
  onMutate?: (variables?: unknown) => unknown | Promise<unknown>;
  onError?: (error: unknown, variables?: unknown, context?: unknown) => void;
  onSuccess?: (
    data: unknown,
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

vi.mock('@/lib/invalidate-store-readiness', () => ({
  invalidateStoreReadiness: mocks.invalidateStoreReadiness,
}));
vi.mock('@react-native-vector-icons/ionicons', () => ({
  Ionicons: () => null,
  default: () => null,
  __esModule: true,
}));
vi.mock('expo-router', () => ({
  Stack: {
    Screen: ({
      options,
    }: {
      options?: { headerRight?: () => React.ReactNode; title?: string };
    }) => (
      <div data-testid="stack-screen" data-title={options?.title}>
        {options?.headerRight?.()}
      </div>
    ),
  },
  useRouter: () => ({ back: mocks.back }),
  useLocalSearchParams: () => mocks.routeParams,
}));
vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      background: '#fff',
      card: '#f5f5f5',
      text: '#000',
      textSecondary: '#666',
      textMuted: '#999',
      border: '#ddd',
      primary: '#6200ea',
      textOnPrimary: '#fff',
    },
    shadows: { sm: {} },
  }),
}));
vi.mock('@/hooks/useMerchant', () => ({
  useMerchant: () => mocks.useMerchant(),
}));
vi.mock('@/lib/merchant-settings', () => ({
  updateMerchantSettings: mocks.updateMerchantSettings,
}));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
  useMutation: (options: MutationOptions) => {
    mocks.useMutation(options);
    return {
      mutate: (variables?: unknown) => {
        const mutation = (async () => {
          const context = await options.onMutate?.(variables);
          try {
            const data = await options.mutationFn(variables);
            await options.onSuccess?.(data, variables, context);
            await options.onSettled?.(data, null, variables, context);
          } catch (error) {
            options.onError?.(error, variables, context);
            await options.onSettled?.(null, error, variables, context);
          }
        })();
        mocks.lastMutation = mutation;
        return mutation;
      },
      isPending: false,
    };
  },
}));
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock('@/components/ui/ScreenSkeleton', () => ({
  ScreenSkeleton: () => (
    <div data-testid="screen-skeleton">Skeleton Loading</div>
  ),
}));
vi.mock('@/components/ui/AppKeyboardContainer', () => ({
  AppKeyboardContainer: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock('react-native', async () => {
  const React = await import('react');
  const Text = ({ children }: { children?: React.ReactNode }) => (
    <span>{children}</span>
  );
  return {
    StatusBar: () => null,
    ActivityIndicator: () => <Text>Loading...</Text>,
    Alert: { alert: mocks.alert },
    Pressable: ({
      children,
      onPress,
      disabled,
    }: {
      children?: React.ReactNode;
      onPress?: () => void;
      disabled?: boolean;
    }) =>
      React.createElement(
        'button',
        { onClick: onPress, disabled, type: 'button' },
        children
      ),
    Text,
    TextInput: ({
      accessibilityLabel,
      onChangeText,
      placeholder,
      value,
    }: {
      accessibilityLabel?: string;
      onChangeText?: (value: string) => void;
      placeholder?: string;
      value?: string;
    }) =>
      React.createElement('input', {
        'aria-label': accessibilityLabel ?? placeholder,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
          onChangeText?.(event.target.value),
        placeholder,
        value: value ?? '',
      }),
    View: ({ children }: { children?: React.ReactNode }) => (
      <div>{children}</div>
    ),
    StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1 },
  };
});

import SocialMediaScreen from '@/app/(admin)/social-media';

export const socialMediaTestHarness = {
  Component: SocialMediaScreen,
  cleanup,
  mocks,
  render: () => render(<SocialMediaScreen />),
  reset: () => {
    vi.clearAllMocks();
    mocks.invalidateStoreReadiness.mockResolvedValue(undefined);
    mocks.invalidateQueries.mockResolvedValue(undefined);
    mocks.lastMutation = null;
    mocks.routeParams = {};
    mocks.useMerchant.mockReturnValue({
      merchant: { id: 'merchant-1', social_media: {} },
      isLoading: false,
    });
  },
};
