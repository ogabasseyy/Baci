import type { ReactNode } from 'react';
import { vi } from 'vitest';
import type { Domain } from './domain-types';

const mocks = vi.hoisted(() => ({
  onExit: null as null | ((finished: boolean) => void),
  onDismiss: null as null | (() => void),
  platform: { OS: 'android' },
}));

export { mocks };

vi.mock('@/config/runtime-platform', () => ({
  isRuntimePlatform: (platform: string) => mocks.platform.OS === platform,
}));

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      background: '#ffffff',
      border: '#e2e8f0',
      card: '#f8fafc',
      error: '#dc2626',
      errorLight: '#fee2e2',
      primary: '#2563eb',
      primaryLight: '#dbeafe',
      success: '#16a34a',
      successLight: '#dcfce7',
      text: '#0f172a',
      textMuted: '#64748b',
      textSecondary: '#334155',
      warning: '#ca8a04',
      warningLight: '#fef9c3',
    },
    shadows: {
      lg: {},
    },
  }),
}));

vi.mock('@react-native-vector-icons/ionicons', () => ({
  Ionicons: ({ name }: { name?: string }) => (
    <span aria-hidden="true" data-icon={name} />
  ),

  default: ({ name }: { name?: string }) => (
    <span aria-hidden="true" data-icon={name} />
  ),
  __esModule: true,
}));

vi.mock('react-native-reanimated', () => {
  const MockAnimatedView = ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  );

  return {
    default: {
      View: MockAnimatedView,
    },
    FadeIn: {},
    FadeOut: {},
    SlideInDown: {},
    SlideOutDown: {
      duration: () => ({
        withCallback: (callback: (finished: boolean) => void) => {
          mocks.onExit = callback;
          return {};
        },
      }),
    },
    runOnJS: (callback: (finished: boolean) => void) => callback,
  };
});

vi.mock('react-native', () => ({
  Modal: ({
    children,
    visible,
    onDismiss,
  }: {
    children?: ReactNode;
    visible?: boolean;
    onDismiss?: () => void;
  }) => {
    mocks.onDismiss = onDismiss ?? null;
    return visible ? <div>{children}</div> : null;
  },
  Pressable: ({
    accessibilityLabel,
    children,
    onPress,
    style,
  }: {
    accessibilityLabel?: string;
    children?: ReactNode;
    onPress?: () => void;
    style?: unknown;
  }) => {
    const resolvedStyle =
      typeof style === 'function' ? style({ pressed: false }) : style;
    return (
      <button
        type="button"
        aria-label={accessibilityLabel}
        data-has-style={Boolean(resolvedStyle)}
        onClick={() => onPress?.()}
      >
        {children}
      </button>
    );
  },
  Platform: mocks.platform,
  StyleSheet: {
    absoluteFillObject: {},
    create: (styles: Record<string, unknown>) => styles,
  },
  StatusBar: () => null,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

export const baseDomain: Domain = {
  created_at: '2026-05-01T00:00:00Z',
  domain: 'shop.usebaci.com',
  domain_type: 'custom',
  id: 'domain_1',
  is_primary: false,
  status: 'pending',
};
