import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isLoading: false,
  user: {
    id: 'user-1',
    email: 'ada@example.com',
    user_metadata: { first_name: 'Ada' },
  } as null | {
    id: string;
    email: string;
    user_metadata: Record<string, unknown>;
  },
}));

vi.mock('react-native', async () => {
  const React = await import('react');
  return {
    ActivityIndicator: () => React.createElement('span', null, 'loading'),
    StatusBar: () => null,
    StyleSheet: {
      absoluteFill: {},
      create: (styles: Record<string, unknown>) => styles,
    },
    Text: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('span', null, children),
    View: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', null, children),
  };
});
vi.mock('react-native-safe-area-context', async () => {
  const React = await import('react');
  return {
    SafeAreaView: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', null, children),
  };
});
vi.mock('expo-linear-gradient', () => ({ LinearGradient: () => null }));
vi.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => <span>redirect:{href}</span>,
}));
vi.mock('@react-native-vector-icons/ionicons', () => ({ default: () => null }));
vi.mock('@/components/auth/onboarding-chat/MerchantSetupChat', () => ({
  MerchantSetupChat: () => <div>merchant setup chat</div>,
}));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    isLoading: mocks.isLoading,
    user: mocks.user,
  }),
}));
vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      background: '#fff',
      primary: '#111',
      text: '#111',
    },
    isDark: false,
  }),
}));

import CompleteProfileScreen from './complete-profile';

describe('CompleteProfileScreen', () => {
  beforeEach(() => {
    mocks.isLoading = false;
    mocks.user = {
      id: 'user-1',
      email: 'ada@example.com',
      user_metadata: { first_name: 'Ada' },
    };
  });

  it('hosts authenticated chat merchant setup without a second registration path', () => {
    render(<CompleteProfileScreen />);

    expect(screen.getByText('Complete Setup')).toBeTruthy();
    expect(screen.getByText('Baci AI')).toBeTruthy();
    expect(screen.getByText('merchant setup chat')).toBeTruthy();
  });

  it('redirects a signed-out deep link to login after auth initializes', () => {
    mocks.user = null;

    render(<CompleteProfileScreen />);

    expect(screen.getByText('redirect:/(auth)/login')).toBeTruthy();
    expect(screen.queryByText('loading')).toBeNull();
  });

  it('shows loading only while auth is still initializing', () => {
    mocks.isLoading = true;
    mocks.user = null;

    render(<CompleteProfileScreen />);

    expect(screen.getByText('loading')).toBeTruthy();
    expect(screen.queryByText('redirect:/(auth)/login')).toBeNull();
  });
});
