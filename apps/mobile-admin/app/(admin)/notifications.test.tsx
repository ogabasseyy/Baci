import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  mutate: vi.fn(),
  preferences: {
    merchant_id: 'merchant-1',
    in_app_enabled: true,
    banner_enabled: true,
    follow_up_notifications_enabled: true,
    quiet_hours_start: null,
    quiet_hours_end: null,
  },
  mutationOptions: null as {
    mutationFn: (updates: unknown) => Promise<unknown>;
  } | null,
  upsert: vi.fn(async () => ({ error: null })),
}));

vi.mock('@tanstack/react-query', () => ({
  useMutation: (options: typeof mocks.mutationOptions) => {
    mocks.mutationOptions = options;
    return {
      mutate: (updates: unknown) => {
        mocks.mutate(updates);
        void options?.mutationFn(updates);
      },
      isPending: false,
    };
  },
  useQuery: () => ({
    data: mocks.preferences,
    error: null,
    isLoading: false,
    refetch: vi.fn(),
  }),
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));

vi.mock('expo-router', async () => {
  const React = await import('react');
  return {
    Stack: { Screen: () => React.createElement('div') },
    useRouter: () => ({ back: vi.fn() }),
  };
});

vi.mock('@react-native-vector-icons/ionicons', () => ({
  default: () => null,
}));

vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children?: ReactNode }) => children,
}));

vi.mock('react-native', async () => {
  const React = await import('react');
  return {
    Alert: { alert: vi.fn() },
    Pressable: ({
      accessibilityLabel,
      children,
      onPress,
    }: {
      accessibilityLabel?: string;
      children?: ReactNode;
      onPress?: () => void;
    }) =>
      React.createElement(
        'button',
        { 'aria-label': accessibilityLabel, onClick: onPress, type: 'button' },
        children
      ),
    ScrollView: ({ children }: { children?: ReactNode }) =>
      React.createElement('div', null, children),
    StatusBar: () => null,
    Switch: ({
      accessibilityLabel,
      onValueChange,
      value,
    }: {
      accessibilityLabel?: string;
      onValueChange?: (value: boolean) => void;
      value?: boolean;
    }) =>
      React.createElement('button', {
        'aria-checked': value ?? false,
        'aria-label': accessibilityLabel,
        onClick: () => onValueChange?.(!(value ?? false)),
        role: 'switch',
        type: 'button',
      }),
    Text: ({ children }: { children?: ReactNode }) =>
      React.createElement('span', null, children),
    View: ({ children }: { children?: ReactNode }) =>
      React.createElement('div', null, children),
  };
});

vi.mock('@/components/notifications/notifications.styles', () => ({
  styles: new Proxy(
    {},
    {
      get: () => ({}),
    }
  ),
}));
vi.mock('@/components/ui/ScreenSkeleton', () => ({
  ScreenSkeleton: () => null,
}));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));
vi.mock('@/hooks/useMerchant', () => ({
  useMerchant: () => ({
    merchant: { id: 'merchant-1' },
    isLoading: false,
  }),
}));
vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      background: '#fff',
      border: '#eee',
      card: '#fafafa',
      notification: '#d00',
      primary: '#25f',
      text: '#012',
      textMuted: '#678',
      textSecondary: '#345',
    },
    isDark: false,
    shadows: { sm: {} },
  }),
}));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({ upsert: mocks.upsert }),
  },
}));

import NotificationsScreen from './notifications';

describe('NotificationsScreen follow-up alerts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.preferences.follow_up_notifications_enabled = true;
    mocks.mutationOptions = null;
  });

  it('renders follow-up alerts enabled by default', () => {
    render(<NotificationsScreen />);

    expect(
      screen.getByRole('switch', { name: 'Follow-up alerts' })
    ).toBeChecked();
    expect(
      screen.getByText(
        'Alert me when a customer creates an invoice that needs follow-up'
      )
    ).toBeInTheDocument();
  });

  it('persists disabling follow-up alerts through the notification preferences mutation', () => {
    render(<NotificationsScreen />);

    fireEvent.click(screen.getByRole('switch', { name: 'Follow-up alerts' }));

    expect(mocks.mutate).toHaveBeenCalledWith({
      follow_up_notifications_enabled: false,
    });
  });
});
