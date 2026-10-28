import { render, screen } from '@testing-library/react-native';

const mockUseSavingsPlanFunding = jest.fn();
let mockEarningsAvailable: boolean | undefined;
const goal = {
  current_amount: 0,
  id: '430314fd-cd8b-4579-98d4-e9f345713dd6',
  source_mode: 'manual',
  status: 'active',
  target_amount: 250000,
  title: 'iPhone savings',
};

jest.mock('expo-router', () => ({
  Redirect: () => null,
  Stack: { Screen: () => null },
  router: { back: jest.fn() },
  useLocalSearchParams: () => ({
    amount: '250000',
    goalId: '430314fd-cd8b-4579-98d4-e9f345713dd6',
  }),
}));
jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'dark',
}));
jest.mock('@/components/storefront/StorefrontScreenShell', () => ({
  StorefrontScreenShell: ({ children }: { children: React.ReactNode }) =>
    children,
}));
jest.mock('@/components/ui/AppKeyboardAwareScrollView', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/hooks/use-auth-guard', () => ({
  useRequireAuth: () => ({ isLoading: false, redirectTo: null }),
}));
jest.mock('@/hooks/use-wallet', () => ({
  useWallet: () => ({
    data: {
      wallet: {
        active_savings_goal: goal,
        savings_goals: [goal],
        ...(mockEarningsAvailable === undefined
          ? {}
          : { earnings_available: mockEarningsAvailable }),
      },
    },
    isLoading: false,
    isRefetching: false,
    refetch: jest.fn(),
  }),
}));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) =>
    selector({ merchantId: 'merchant-1', user: { id: 'customer-1' } }),
}));
jest.mock('@/components/wallet/savings/use-savings-plan-funding', () => ({
  useSavingsPlanFunding: (...args: unknown[]) => {
    mockUseSavingsPlanFunding(...args);
    return {
      fetchExistingPlanFunding: jest.fn(),
      fetchPlanFunding: jest.fn(),
      fundingError: null,
      planFundingAccounts: [
        {
          accountName: 'Savings',
          accountNumber: '0000000000',
          bankName: 'Test Bank',
        },
      ],
      planFundingPhase: 'ready',
      planFundingStatusCode: null,
    };
  },
}));
jest.mock('@/lib/is-hosted-staging-wallet-top-up-blocked', () => ({
  isHostedStagingTestPaymentsEnabled: () => true,
}));
jest.mock('@/lib/clipboard', () => ({ setClipboardString: jest.fn() }));

import SavingsPlanFundingRoute from '../../../app/savings/funding';

it.each([
  false,
  undefined,
])('does not expose plan funding for legacy wallet earnings_available=%s', (earningsAvailable) => {
  mockEarningsAvailable = earningsAvailable;
  mockUseSavingsPlanFunding.mockClear();

  render(<SavingsPlanFundingRoute />);

  expect(
    screen.getByText(
      /progress is unavailable because earnings could not be confirmed/i
    )
  ).toBeOnTheScreen();
  expect(screen.queryByText('0000000000')).toBeNull();
  expect(mockUseSavingsPlanFunding).toHaveBeenLastCalledWith(
    expect.objectContaining({ goalId: null, loadExisting: false })
  );
});
