import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MenuScreen from './menu';

const mocks = vi.hoisted(() => ({
  alert: vi.fn(),
  hasFeature: vi.fn(),
  hasFullProAccess: vi.fn(),
  isPro: true,
  merchant: {
    id: 'merchant-1',
    plan_expires_at: null as string | null,
    plan_tier: 'free' as string | null,
    premium_features: [] as string[],
  },
  merchantLoading: false,
  router: { push: vi.fn(), replace: vi.fn() },
}));

vi.mock('expo-router', () => ({ useRouter: () => mocks.router }));
vi.mock('@react-native-vector-icons/ionicons', () => ({
  default: ({ name }: { name?: string }) => <span data-icon={name} />,
  __esModule: true,
}));
vi.mock('react-native', () => ({
  Alert: { alert: mocks.alert },
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
  StyleSheet: { create: (styles: Record<string, unknown>) => styles },
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children?: ReactNode }) => (
    <section>{children}</section>
  ),
}));
vi.mock('@/components/settings/SubscriptionStatusCard', () => ({
  SubscriptionStatusCard: ({
    isLoading,
    isPro,
    onPress,
  }: {
    isLoading?: boolean;
    isPro?: boolean;
    onPress?: () => void;
  }) => (
    <button onClick={onPress} type="button">
      {isLoading ? 'Loading subscription status' : null}
      {isPro ? 'Baci Pro Merchant Active' : 'Free Plan UPGRADE'}
    </button>
  ),
}));
vi.mock('@/context/OnboardingContext', () => ({
  useOnboarding: () => ({ resetOnboarding: vi.fn() }),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ signOut: vi.fn() }) }));
vi.mock('@/hooks/useExpenseAccess', () => ({
  useExpenseAccess: () => ({ canView: true }),
}));
vi.mock('@/hooks/useMerchant', () => ({
  useMerchant: () => ({
    isLoading: mocks.merchantLoading,
    merchant: mocks.merchant,
  }),
}));
vi.mock('@/hooks/usePushNotifications', () => ({
  usePushNotifications: () => ({ unregisterPush: vi.fn() }),
}));
vi.mock('@/hooks/useRevenueCat', () => ({
  useRevenueCat: () => ({ customerInfo: null, isPro: mocks.isPro }),
}));
vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      background: '#fff',
      border: '#e2e8f0',
      card: '#fff',
      cardHover: '#f8fafc',
      error: '#dc2626',
      gold: '#b45309',
      goldLight: '#fef3c7',
      primary: '#2563eb',
      text: '#0f172a',
      textMuted: '#64748b',
      textSecondary: '#475569',
    },
    isDark: false,
    shadows: { sm: {} },
  }),
}));
vi.mock('@/lib/feature-gates', () => ({
  baciFeatureGates: {
    hasFeature: (...args: unknown[]) => mocks.hasFeature(...args),
    hasFullProAccess: (...args: unknown[]) => mocks.hasFullProAccess(...args),
  },
}));

describe('MenuScreen subscription access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('__DEV__', false);
    mocks.hasFeature.mockReturnValue(true);
    mocks.hasFullProAccess.mockReturnValue(false);
    mocks.isPro = true;
    mocks.merchantLoading = false;
    mocks.merchant = {
      id: 'merchant-1',
      plan_expires_at: null,
      plan_tier: 'free',
      premium_features: [],
    };
  });

  it('routes accessible feature rows directly', () => {
    render(<MenuScreen />);
    fireEvent.click(
      screen.getByRole('button', { name: /Domains\. Custom domain settings/i })
    );
    expect(mocks.router.push).toHaveBeenCalledWith('/domains');
  });

  it('routes feature rows when RevenueCat reports Pro', () => {
    mocks.hasFeature.mockReturnValue(false);
    render(<MenuScreen />);
    fireEvent.click(
      screen.getByRole('button', { name: /Domains\. Custom domain settings/i })
    );
    expect(mocks.router.push).toHaveBeenCalledWith('/domains');
    expect(mocks.alert).not.toHaveBeenCalled();
  });

  it('does not route locked feature rows without DB or RevenueCat access', () => {
    mocks.hasFeature.mockReturnValue(false);
    mocks.isPro = false;
    render(<MenuScreen />);
    fireEvent.click(
      screen.getByRole('button', { name: /Domains\. Custom domain settings/i })
    );
    expect(mocks.router.push).not.toHaveBeenCalledWith('/domains');
    expect(mocks.alert).toHaveBeenCalledWith(
      'Baci Pro',
      'Domains is available on Baci Pro.',
      expect.any(Array)
    );
  });

  it('opens the subscription screen from the free plan card', () => {
    mocks.hasFeature.mockReturnValue(false);
    mocks.isPro = false;
    render(<MenuScreen />);
    fireEvent.click(screen.getByRole('button', { name: /Free Plan UPGRADE/i }));
    expect(mocks.router.push).toHaveBeenCalledWith('/(admin)/subscribe');
  });

  it('shows Pro status when the merchant has a server-backed Pro entitlement', () => {
    mocks.hasFullProAccess.mockReturnValue(true);
    mocks.isPro = false;
    mocks.merchant = {
      id: 'merchant-1',
      plan_expires_at: null,
      plan_tier: 'pro',
      premium_features: [],
    };
    render(<MenuScreen />);
    expect(screen.getByText(/Baci Pro Merchant Active/i)).toBeTruthy();
    expect(screen.queryByText(/Free Plan UPGRADE/i)).toBeNull();
  });

  it('keeps the upgrade card for product-limit-only grants', () => {
    mocks.hasFeature.mockImplementation(
      (_merchant: unknown, feature: unknown) => feature === 'product_limit'
    );
    mocks.hasFullProAccess.mockReturnValue(false);
    mocks.isPro = false;
    mocks.merchant = {
      id: 'merchant-1',
      plan_expires_at: null,
      plan_tier: 'free',
      premium_features: ['product_limit'],
    };
    render(<MenuScreen />);
    expect(screen.getByText(/Free Plan UPGRADE/i)).toBeTruthy();
    expect(screen.queryByText(/Baci Pro Merchant Active/i)).toBeNull();
  });

  it('passes loading state to the subscription card for non-Pro merchant loads', () => {
    mocks.isPro = false;
    mocks.merchantLoading = true;
    render(<MenuScreen />);
    expect(
      screen.getByRole('button', {
        name: /Loading subscription status.*Free Plan UPGRADE/i,
      })
    ).toBeTruthy();
  });
});
