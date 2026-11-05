import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react-native';
import { useRequireAuth } from '@/hooks/use-auth-guard';
import { useWallet } from '@/hooks/use-wallet';
import { issueGoalAction } from '@/lib/goal-lifecycle-api';
import { isPiggyvestPrimaryMerchant } from '@/lib/is-piggyvest-primary-merchant';
import { piggyvestPrimaryWalletApi } from '@/lib/piggyvest-primary-wallet';
import { useAuthStore } from '@/stores/auth-store';
import {
  SERVER_OFF_GOAL_ID,
  SERVER_OFF_MERCHANT_ID,
  serverOffError,
} from '@/test-support/piggyvest-server-off.test-support';

jest.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => {
    const { Text } = jest.requireActual('react-native');
    return <Text>{`Redirect:${href}`}</Text>;
  },
  Stack: { Screen: () => null },
  router: { replace: jest.fn() },
  useLocalSearchParams: () => ({
    goalId: '22222222-2222-4222-8222-222222222222',
    kind: 'cancel',
  }),
}));
jest.mock('@/components/storefront/StorefrontScreenShell', () => ({
  StorefrontScreenShell: ({ children }: { children: React.ReactNode }) =>
    children,
}));
jest.mock('@/hooks/use-wallet', () => ({
  useWallet: jest.fn(),
  walletKeys: { all: ['wallet'] },
}));
jest.mock('@/hooks/use-auth-guard');
jest.mock('@/lib/goal-lifecycle-api');
jest.mock('@/lib/piggyvest-primary-wallet');
jest.mock('@/lib/is-piggyvest-primary-merchant');

import WalletGoalActionsRoute from '@/app/wallet/savings/goal-actions';

describe('server keeps PiggyVest off', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(isPiggyvestPrimaryMerchant).mockReturnValue(true);
    act(() => {
      useAuthStore.setState({
        user: { id: 'u' } as never,
        merchantId: SERVER_OFF_MERCHANT_ID,
      });
    });
    jest
      .mocked(useRequireAuth)
      .mockReturnValue({ redirectTo: null, user: { id: 'u' } } as never);
    jest.mocked(useWallet).mockReturnValue({
      data: {
        wallet: {
          savings_goals: [
            { id: SERVER_OFF_GOAL_ID, title: 'G', current_amount: 1 },
          ],
        },
        transactions: [],
      },
      isLoading: false,
    } as never);
  });

  it('sends a customer the server will not serve back to the wallet, with no lifecycle request', async () => {
    jest
      .mocked(piggyvestPrimaryWalletApi.read)
      .mockRejectedValue(serverOffError());
    render(
      <QueryClientProvider client={new QueryClient()}>
        <WalletGoalActionsRoute />
      </QueryClientProvider>
    );
    expect(await screen.findByText('Redirect:/wallet')).toBeOnTheScreen();
    expect(screen.queryByText('Continue')).toBeNull();
    expect(issueGoalAction).not.toHaveBeenCalled();
  });
});
