import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MenuScreen from './menu';

const mocks = vi.hoisted(() => ({
  alert: vi.fn(),
  expenseAccess: {
    canCreate: false,
    canEdit: false,
    canManageIntegrations: true,
    canView: true,
    error: null as Error | null,
    isLoading: false,
  },
  hasFeature: vi.fn(),
  hasFullProAccess: vi.fn(),
  isPro: true,
  merchant: {
    country: 'NG' as string | null,
    id: 'merchant-1',
    user_id: 'user-1',
    plan_expires_at: null as string | null,
    plan_tier: 'free' as string | null,
    premium_features: [] as string[],
  } as {
    country: string | null;
    id: string;
    user_id: string;
    plan_expires_at: string | null;
    plan_tier: string | null;
    premium_features: string[];
  } | null,
  merchantLoading: false,
  resetOnboarding: vi.fn(),
  router: {
    push: vi.fn(),
    replace: vi.fn(),
  },
  signOut: vi.fn(),
  unregisterPush: vi.fn(),
}));

vi.mock('expo-router', () => ({
  useRouter: () => mocks.router,
}));

vi.mock('@react-native-vector-icons/ionicons', () => ({
  default: ({ name }: { name?: string }) => (
    <span aria-hidden="true" data-icon={name} />
  ),
  __esModule: true,
}));

vi.mock('react-native', () => ({
  Alert: { alert: mocks.alert },
  Pressable: ({
    accessibilityLabel,
    children,
    disabled,
    onPress,
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
  ScrollView: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  StatusBar: () => null,
  StyleSheet: {
    create: (styles: Record<string, unknown>) => styles,
  },
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
    <button onClick={() => onPress?.()} type="button">
      {isLoading ? 'Loading subscription status' : null}
      {isPro ? 'Baci Pro Merchant Active' : 'Free Plan UPGRADE'}
    </button>
  ),
}));

vi.mock('@/context/OnboardingContext', () => ({
  useOnboarding: () => ({
    resetOnboarding: mocks.resetOnboarding,
  }),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    signOut: mocks.signOut,
    user: { id: 'user-1' },
  }),
}));

vi.mock('@/hooks/useExpenseAccess', () => ({
  useExpenseAccess: () => mocks.expenseAccess,
}));

vi.mock('@/hooks/useMerchant', () => ({
  useMerchant: () => ({
    isLoading: mocks.merchantLoading,
    merchant: mocks.merchant,
  }),
}));

vi.mock('@/hooks/usePushNotifications', () => ({
  usePushNotifications: () => ({
    unregisterPush: mocks.unregisterPush,
  }),
}));

vi.mock('@/hooks/useRevenueCat', () => ({
  useRevenueCat: () => ({
    customerInfo: null,
    isPro: mocks.isPro,
  }),
}));

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      background: '#ffffff',
      border: '#e2e8f0',
      card: '#ffffff',
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

describe('MenuScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('__DEV__', false);
    mocks.hasFeature.mockReturnValue(true);
    mocks.hasFullProAccess.mockReturnValue(false);
    mocks.expenseAccess = {
      canCreate: false,
      canEdit: false,
      canManageIntegrations: true,
      canView: true,
      error: null,
      isLoading: false,
    };
    mocks.isPro = true;
    mocks.merchantLoading = false;
    mocks.merchant = {
      country: 'NG',
      id: 'merchant-1',
      user_id: 'user-1',
      plan_expires_at: null,
      plan_tier: 'free',
      premium_features: [],
    };
  });

  it('renders the main menu sections', () => {
    render(<MenuScreen />);

    expect(screen.getByText('Menu')).toBeTruthy();
    expect(screen.getByText('Store')).toBeTruthy();
    expect(screen.getByText('Business')).toBeTruthy();
    expect(screen.getByText('Support')).toBeTruthy();
    expect(screen.getByText('Account')).toBeTruthy();
  });

  it('hides identity verification while merchant context is unresolved', () => {
    mocks.merchant = null;

    render(<MenuScreen />);

    expect(
      screen.queryByRole('button', {
        name: 'Identity Verification. Manage NIN, BVN, and CAC verification',
      })
    ).toBeNull();
  });

  it('navigates to security from the main menu', () => {
    render(<MenuScreen />);

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Security. Password and two-factor authentication',
      })
    );

    expect(mocks.router.push).toHaveBeenCalledWith('/(admin)/security');
  });

  it('renders Expenses when the caller can view expenses', () => {
    render(<MenuScreen />);

    expect(
      screen.getByRole('button', {
        name: 'Expenses. Track spending and receipts',
      })
    ).toBeTruthy();
  });

  it.each([
    ['denied access', { canView: false, isLoading: false, error: null }],
    ['loading access', { canView: false, isLoading: true, error: null }],
    [
      'failed access',
      { canView: false, isLoading: false, error: new Error('No access') },
    ],
  ])('omits Expenses structurally during %s', (_state, access) => {
    mocks.expenseAccess = {
      canCreate: false,
      canEdit: false,
      canManageIntegrations: true,
      ...access,
    };

    render(<MenuScreen />);

    expect(
      screen.queryByRole('button', {
        name: 'Expenses. Track spending and receipts',
      })
    ).toBeNull();
    expect(screen.queryByText('Expenses')).toBeNull();
  });

  it('navigates to negotiations from the menu', () => {
    render(<MenuScreen />);

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Negotiation Requests. Manage price negotiation requests',
      })
    );

    expect(mocks.router.push).toHaveBeenCalledWith('/(admin)/negotiations');
  });

  it('navigates to repair bookings from the menu', () => {
    render(<MenuScreen />);

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Repair Bookings. Manage repair service requests',
      })
    );

    expect(mocks.router.push).toHaveBeenCalledWith('/(admin)/repairs');
  });
});
