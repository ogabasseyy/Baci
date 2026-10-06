import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

const mockFetchPlanFunding = jest.fn();
const mockFetchExistingPlanFunding = jest.fn();
const mockIsHostedStagingTestPaymentsEnabled = jest.fn();
const mockRedirect = jest.fn();
const mockRefetch = jest.fn(async () => ({ isError: false }));
const mockSetClipboardString = jest.fn(
  async (_text: string): Promise<boolean> => true
);
const defaultPlanFundingAccounts = () => [
  {
    accountName: 'PiggyVest Savings',
    accountNumber: '0001234567',
    bankName: 'Test Bank',
  },
];
let mockPlanFundingAccounts = defaultPlanFundingAccounts();
const mockUseSavingsPlanFunding = jest.fn();
const mockKeyboardAwareScrollViewSpy = jest.fn();
let mockUserId: string | null = 'customer-1';
let mockSavingsGoals: ReturnType<typeof defaultActiveGoal>[] = [];
const mockAuthListeners = new Set<() => void>();
let mockParams: Record<string, string | string[]> = {
  amount: '250000',
  goalId: '430314fd-cd8b-4579-98d4-e9f345713dd6',
};
const defaultActiveGoal = () => ({
  current_amount: 0,
  id: '430314fd-cd8b-4579-98d4-e9f345713dd6',
  source_mode: 'manual',
  status: 'active',
  target_amount: 250000,
  title: 'iPhone savings',
});
let mockActiveGoal: ReturnType<typeof defaultActiveGoal> | null =
  defaultActiveGoal();

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
        active_savings_goal: mockActiveGoal,
        savings_goals: mockSavingsGoals,
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
      planFundingAccounts: mockPlanFundingAccounts,
      planFundingPhase: 'ready',
      planFundingStatusCode: null,
    };
  },
}));
jest.mock('@/lib/clipboard', () => ({
  setClipboardString: (text: string) => mockSetClipboardString(text),
}));
jest.mock('@/lib/is-hosted-staging-wallet-top-up-blocked', () => ({
  isHostedStagingTestPaymentsEnabled: () =>
    mockIsHostedStagingTestPaymentsEnabled(),
}));

import SavingsPlanFundingRoute, {
  parseRequestedAmount,
} from '../../../app/savings/funding';

describe('SavingsPlanFundingRoute', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUserId = 'customer-1';
    mockIsHostedStagingTestPaymentsEnabled.mockReturnValue(true);
    mockActiveGoal = defaultActiveGoal();
    mockSavingsGoals = [];
    mockPlanFundingAccounts = defaultPlanFundingAccounts();
    mockParams = {
      amount: '250000',
      goalId: '430314fd-cd8b-4579-98d4-e9f345713dd6',
    };
  });

  it('shows the selected plan account without opening a wallet card payment', async () => {
    render(<SavingsPlanFundingRoute />);

    expect(screen.getByText('₦250,000')).toBeOnTheScreen();
    expect(screen.getByText('0001234567')).toBeOnTheScreen();
    // The gate mock returns true, so the details must render the same
    // staging copy the gate implies — never the production transfer copy.
    expect(
      screen.getByText(/do not send a real bank transfer/i)
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

  it('takes the first value when funding-link params repeat in the URL', () => {
    mockParams = {
      amount: ['250000', '999'],
      goalId: [
        '430314fd-cd8b-4579-98d4-e9f345713dd6',
        '00000000-0000-4000-8000-000000000000',
      ],
    };

    render(<SavingsPlanFundingRoute />);

    expect(screen.getByText('₦250,000')).toBeOnTheScreen();
    expect(screen.getByText('0001234567')).toBeOnTheScreen();
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

  it('loads an owned requested goal when another goal is the default', () => {
    mockSavingsGoals = [defaultActiveGoal()];
    mockActiveGoal = {
      ...defaultActiveGoal(),
      id: '01932f3e-7a2d-7c1e-b4d5-9f8e7d6c5b4a',
    };
    render(<SavingsPlanFundingRoute />);

    expect(screen.getByText('₦250,000')).toBeOnTheScreen();
    expect(mockUseSavingsPlanFunding).toHaveBeenCalledWith(
      expect.objectContaining({ goalId: mockParams.goalId, loadExisting: true })
    );
  });

  it('accepts UUID v7 goal ids emitted by the backend', () => {
    const v7GoalId = '01932f3e-7a2d-7c1e-b4d5-9f8e7d6c5b4a';
    mockActiveGoal = { ...defaultActiveGoal(), id: v7GoalId };
    mockParams = { amount: '250000', goalId: v7GoalId };
    render(<SavingsPlanFundingRoute />);

    expect(screen.getByText('₦250,000')).toBeOnTheScreen();
    expect(
      screen.queryByText(/no longer matches your active savings plan/i)
    ).toBeNull();
  });

  it('prompts a refresh when the linked amount exceeds the cached remaining balance', () => {
    mockParams = { ...mockParams, amount: '999999999' };
    render(<SavingsPlanFundingRoute />);

    expect(
      screen.getByText(/asks for more than your cached plan balance/i)
    ).toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: 'Refresh plan progress' })
    ).toBeOnTheScreen();
  });

  it('treats a malformed link amount as a mismatched link rather than stale cache', () => {
    mockParams = { ...mockParams, amount: 'not-a-number' };
    render(<SavingsPlanFundingRoute />);

    expect(
      screen.getByText(/no longer matches your active savings plan/i)
    ).toBeOnTheScreen();
    expect(screen.queryByText(/cached plan balance/i)).toBeNull();
  });

  it('prompts a refresh when no plan is cached instead of reporting a dead link', () => {
    mockActiveGoal = null;
    render(<SavingsPlanFundingRoute />);

    expect(
      screen.getByText(/could not find your active savings plan/i)
    ).toBeOnTheScreen();
    expect(
      screen.queryByText(/no longer matches your active savings plan/i)
    ).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Refresh plan progress' })
    ).toBeOnTheScreen();
  });

  it('copies the ready plan account number and confirms', async () => {
    render(<SavingsPlanFundingRoute />);

    await act(async () => {
      fireEvent.press(
        screen.getByRole('button', { name: 'Copy plan account number' })
      );
      await Promise.resolve();
    });

    expect(mockSetClipboardString).toHaveBeenCalledWith('0001234567');
    expect(screen.getByText('Copied')).toBeOnTheScreen();
  });

  it('shows an explicit error when copying the account number fails', async () => {
    mockSetClipboardString.mockResolvedValueOnce(false);
    render(<SavingsPlanFundingRoute />);

    await act(async () => {
      fireEvent.press(
        screen.getByRole('button', { name: 'Copy plan account number' })
      );
      await Promise.resolve();
    });

    expect(
      screen.getByText('Could not copy the account number. Please try again.')
    ).toBeOnTheScreen();
    expect(screen.queryByText('Copied')).toBeNull();
  });

  it('withholds the copy button when the ready account number is empty', () => {
    mockPlanFundingAccounts = [
      {
        accountName: 'PiggyVest Savings',
        accountNumber: '',
        bankName: 'Test Bank',
      },
    ];
    render(<SavingsPlanFundingRoute />);

    expect(
      screen.queryByRole('button', { name: 'Copy plan account number' })
    ).toBeNull();
    expect(mockSetClipboardString).not.toHaveBeenCalled();
  });
});

describe('parseRequestedAmount', () => {
  it('accepts positive decimal integers', () => {
    expect(parseRequestedAmount('20000')).toBe(20000);
    expect(parseRequestedAmount('007')).toBe(7);
  });

  it.each([
    ['0x10'],
    ['1e3'],
    ['  50  '],
    ['10.5'],
    ['-5'],
    [''],
    ['20,000'],
  ])('rejects non-decimal shape %s', (value) => {
    expect(parseRequestedAmount(value)).toBeNull();
  });

  it('rejects zero and unsafe integers', () => {
    expect(parseRequestedAmount('0')).toBeNull();
    expect(
      parseRequestedAmount(String(Number.MAX_SAFE_INTEGER + 1))
    ).toBeNull();
  });
});
