import type { User } from '@supabase/supabase-js';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { isPiggyvestPrimaryMerchant } from '@/lib/is-piggyvest-primary-merchant';
import { piggyvestPrimaryWalletApi } from '@/lib/piggyvest-primary-wallet';
import { useAuthStore } from '@/stores/auth-store';
import {
  expectNoPiggyvestUi,
  SERVER_OFF_GOAL_ID,
  SERVER_OFF_MERCHANT_ID,
  serverOffError,
} from '@/test-support/piggyvest-server-off.test-support';
import { useSavingsPlanFunding } from './savings/use-savings-plan-funding';
import { WalletSavingsFundingSection } from './WalletSavingsFundingSection';

jest.mock('./WalletSavingsContributionFlow', () => ({
  WalletSavingsContributionFlow: () => {
    const { Text } = require('react-native');
    return <Text>wallet-contribution</Text>;
  },
}));
jest.mock('@/lib/piggyvest-primary-wallet');
jest.mock('@/lib/is-piggyvest-primary-merchant');
jest.mock('./savings/use-savings-plan-funding', () => ({
  useSavingsPlanFunding: jest.fn(),
}));
jest.mock('./WalletSavingsPlanFunding', () => ({
  WalletSavingsPlanFunding: () => {
    const { Text } = require('react-native');
    return <Text>plan-funding</Text>;
  },
}));

const goal = {
  id: 'g1',
  source_mode: 'manual',
} as unknown as WalletActiveSavingsGoal;
const props = {
  addAmount: '',
  colors: Colors.dark,
  goal,
  isAdding: false,
  isFundPending: false,
  onAddAmountChange: jest.fn(),
  onAddSavings: jest.fn(),
  onFundWallet: jest.fn(),
  remainingAmount: 1000,
  walletBalance: 0,
};
const authUser: User = {
  id: 'customer-a',
  app_metadata: {},
  user_metadata: {},
  aud: 'authenticated',
  created_at: '2026-01-01T00:00:00.000Z',
};

// Without plan funding the section is today's wallet contribution alone.
describe('server keeps PiggyVest off', () => {
  beforeEach(() => {
    act(() =>
      useAuthStore.setState({
        user: authUser,
        merchantId: SERVER_OFF_MERCHANT_ID,
      })
    );
  });
  it.each([
    true,
    false,
  ])('mounts only the wallet contribution (visible %s)', (visible) => {
    render(
      <WalletSavingsFundingSection
        {...props}
        usesPlanFunding={false}
        visible={visible}
      />
    );
    expect(screen.getByText('wallet-contribution')).toBeOnTheScreen();
    expect(screen.queryByText('plan-funding')).toBeNull();
  });

  it('keeps the wallet contribution for an auto-debit goal too', () => {
    render(
      <WalletSavingsFundingSection
        {...props}
        goal={{ id: 'g2', source_mode: 'auto_debit' } as never}
        usesPlanFunding={false}
        visible
      />
    );
    expect(screen.getByText('wallet-contribution')).toBeOnTheScreen();
    expect(screen.queryByText('plan-funding')).toBeNull();
  });
});

// The real readiness gate: the server refusing, or answering anything but a
// ready wallet, leaves today's output and starts no goal-wallet status read.
describe('server keeps PiggyVest off (readiness gate)', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([
    ['PIGGYVEST_NOT_READY', () => Promise.reject(serverOffError())],
    [
      'a pending wallet',
      () =>
        Promise.resolve({
          account: null,
          requiresConsent: true,
          provisioningStatus: 'pending',
        }),
    ],
  ])('keeps the wallet contribution alone for %s', async (_name, answer) => {
    jest.mocked(isPiggyvestPrimaryMerchant).mockReturnValue(true);
    jest
      .mocked(piggyvestPrimaryWalletApi.read)
      .mockImplementation(answer as never);
    act(() => {
      useAuthStore.setState({
        user: authUser,
        merchantId: SERVER_OFF_MERCHANT_ID,
      });
    });
    render(
      <WalletSavingsFundingSection
        {...props}
        goal={{ id: SERVER_OFF_GOAL_ID, source_mode: 'manual' } as never}
        usesPlanFunding={false}
        visible
      />
    );
    await waitFor(() =>
      expect(screen.getByText('wallet-contribution')).toBeOnTheScreen()
    );
    expect(piggyvestPrimaryWalletApi.read).toHaveBeenCalled();
    expect(useSavingsPlanFunding).not.toHaveBeenCalled();
    expectNoPiggyvestUi();
  });
});
