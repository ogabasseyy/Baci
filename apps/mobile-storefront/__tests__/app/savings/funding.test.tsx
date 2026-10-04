import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

const mockFetchPlanFunding = jest.fn();
const mockFetchExistingPlanFunding = jest.fn();
const mockIsHostedStagingTestPaymentsEnabled = jest.fn();
const mockRedirect = jest.fn();
const mockRefetch = jest.fn(async () => ({ isError: false }));
const mockUseSavingsPlanFunding = jest.fn();
const mockKeyboardAwareScrollViewSpy = jest.fn();
let mockUserId: string | null = 'customer-1';
const mockAuthListeners = new Set<() => void>();
let mockParams: Record<string, string> = {
  amount: '250000',
  goalId: '430314fd-cd8b-4579-98d4-e9f345713dd6',
};

jest.mock('expo-router', () => ({
  Redirect: (props: unknown) => {
    mockRedirect(props);
    return null;
  },
  Stack: { Screen: () => null },
  router: { back: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'dark',
}));
jest.mock('@/components/storefront/StorefrontScreenShell', () => ({
  StorefrontScreenShell: ({ children }: { children: React.ReactNode }) =>
    children,
}));
jest.mock('@/components/ui/AppKeyboardAwareScrollView', () => {
  const { View } =
    jest.requireActual<typeof import('react-native')>('react-native');

  return function MockAppKeyboardAwareScrollView(props: {
    children?: React.ReactNode;
    testID?: string;
  }) {
    mockKeyboardAwareScrollViewSpy(props);
    return <View testID={props.testID}>{props.children}</View>;
  };
});
jest.mock('@/hooks/use-auth-guard', () => ({
  useRequireAuth: () => ({ isLoading: false, redirectTo: null }),
}));
jest.mock('@/hooks/use-wallet', () => ({
  useWallet: () => ({
    data: {
      wallet: {
        active_savings_goal: {
          current_amount: 0,
          id: '430314fd-cd8b-4579-98d4-e9f345713dd6',
          source_mode: 'manual',
          status: 'active',
          target_amount: 250000,
          title: 'iPhone savings',
        },
      },
    },
    isLoading: false,
    isRefetching: false,
    refetch: mockRefetch,
  }),
}));
jest.mock('@/stores/auth-store', () => {
  const { useSyncExternalStore } =
    jest.requireActual<typeof import('react')>('react');
  return {
    useAuthStore: (
      selector: (state: {
        merchantId: string;
        user: { id: string } | null;
      }) => unknown
    ) => {
      const userId = useSyncExternalStore(
        (listener) => {
          mockAuthListeners.add(listener);
          return () => mockAuthListeners.delete(listener);
        },
        () => mockUserId
      );
      return selector({
        merchantId: 'merchant-1',
        user: userId ? { id: userId } : null,
      });
    },
  };
});
jest.mock('@/components/wallet/savings/use-savings-plan-funding', () => ({
  useSavingsPlanFunding: (...args: unknown[]) => {
    mockUseSavingsPlanFunding(...args);
    return {
      fetchExistingPlanFunding: mockFetchExistingPlanFunding,
      fetchPlanFunding: mockFetchPlanFunding,
      fundingError: null,
      planFundingAccounts: [
        {
          accountName: 'PiggyVest Savings',
          accountNumber: '0001234567',
          bankName: 'Test Bank',
        },
      ],
      planFundingPhase: 'ready',
      planFundingStatusCode: null,
    };
  },
}));
jest.mock('@/lib/clipboard', () => ({ setClipboardString: jest.fn() }));
jest.mock('@/lib/is-hosted-staging-wallet-top-up-blocked', () => ({
  isHostedStagingTestPaymentsEnabled: () =>
    mockIsHostedStagingTestPaymentsEnabled(),
}));

import SavingsPlanFundingRoute from '../../../app/savings/funding';

describe('SavingsPlanFundingRoute', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUserId = 'customer-1';
    mockIsHostedStagingTestPaymentsEnabled.mockReturnValue(true);
    mockParams = {
      amount: '250000',
      goalId: '430314fd-cd8b-4579-98d4-e9f345713dd6',
    };
  });

  it('shows the selected plan account without opening a wallet card payment', async () => {
    render(<SavingsPlanFundingRoute />);

    expect(screen.getByText('₦250,000')).toBeOnTheScreen();
    expect(screen.getByText('0001234567')).toBeOnTheScreen();
    expect(
      screen.getByText(/card payments cannot fund this savings plan/i)
    ).toBeOnTheScreen();
    expect(screen.queryByText(/I've made the transfer/i)).toBeNull();
    await act(async () => {
      fireEvent.press(
        screen.getByRole('button', { name: 'Refresh plan progress' })
      );
      await Promise.resolve();
    });
    expect(mockRefetch).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText(/updates after a confirmed contribution/i)
    ).toBeOnTheScreen();
  });

  it('uses the shared keyboard-aware scroll view for small screens', () => {
    render(<SavingsPlanFundingRoute />);

    expect(screen.getByTestId('savings-plan-funding-scroll')).toBeOnTheScreen();
    expect(mockKeyboardAwareScrollViewSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        keyboardDismissMode: 'on-drag',
        showsVerticalScrollIndicator: false,
      })
    );
  });

  it('changes the funding lookup identity when customers switch under the same merchant', () => {
    render(<SavingsPlanFundingRoute />);
    expect(mockUseSavingsPlanFunding).toHaveBeenLastCalledWith(
      expect.objectContaining({ identityKey: 'customer-1' })
    );

    act(() => {
      mockUserId = 'customer-2';
      for (const listener of mockAuthListeners) listener();
    });
    expect(mockUseSavingsPlanFunding).toHaveBeenLastCalledWith(
      expect.objectContaining({ identityKey: 'customer-2' })
    );

    act(() => {
      mockUserId = null;
      for (const listener of mockAuthListeners) listener();
    });
    expect(mockUseSavingsPlanFunding).toHaveBeenLastCalledWith(
      expect.objectContaining({ goalId: null, loadExisting: false })
    );
  });

  it('does not report a refresh as successful when TanStack returns an error result', async () => {
    mockRefetch.mockResolvedValueOnce({ isError: true });
    render(<SavingsPlanFundingRoute />);

    await act(async () => {
      fireEvent.press(
        screen.getByRole('button', { name: 'Refresh plan progress' })
      );
    });

    expect(
      screen.getByText('Unable to refresh plan progress. Please try again.')
    ).toBeOnTheScreen();
    expect(
      screen.queryByText(/updates after a confirmed contribution/i)
    ).toBeNull();
  });

  it('redirects production away from savings funding without mounting a plan lookup', () => {
    mockIsHostedStagingTestPaymentsEnabled.mockReturnValue(false);

    render(<SavingsPlanFundingRoute />);

    expect(mockRedirect).toHaveBeenCalledWith({ href: '/wallet' });
    expect(mockUseSavingsPlanFunding).not.toHaveBeenCalled();
  });

  it('refuses a route goal that is not the active customer goal', () => {
    mockParams = {
      ...mockParams,
      goalId: '33333333-3333-4333-8333-333333333333',
    };
    render(<SavingsPlanFundingRoute />);

    expect(
      screen.getByText(/no longer matches your active savings plan/i)
    ).toBeOnTheScreen();
    expect(mockFetchPlanFunding).not.toHaveBeenCalled();
    fireEvent.press(screen.getByRole('button', { name: 'Back to savings' }));
    expect(router.back).toHaveBeenCalledTimes(1);
  });
});
