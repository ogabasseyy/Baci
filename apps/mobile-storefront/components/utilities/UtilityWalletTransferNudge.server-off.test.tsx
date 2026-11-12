import { fireEvent, render, screen } from '@testing-library/react-native';
import type { WalletReturnHref } from '@/lib/sanitize-wallet-return-to';

const mockRouterPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (route: unknown) => mockRouterPush(route) },
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'intent-1' }));
jest.mock('@/constants/wallet-funding', () => ({
  WALLET_FUNDING_CHECKING_STATE_ENABLED: false,
}));

import { UtilityWalletTransferNudge } from '@/components/utilities/UtilityWalletTransferNudge';
import Colors from '@/constants/Colors';

const RETURN_TO = '/utilities/airtime?repeatAmount=1000' as WalletReturnHref;
const baseProps = {
  amount: 1000,
  canFundByBankTransfer: true,
  colors: Colors.light,
  returnToHref: RETURN_TO,
  walletBalance: 0,
  walletError: null,
  walletIsLoading: false,
};

describe('utility funding nudge', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('keeps the bank transfer nudge when the server keeps PiggyVest off', () => {
    render(<UtilityWalletTransferNudge {...baseProps} />);

    fireEvent.press(
      screen.getByRole('button', { name: 'Pay with Bank Transfer' })
    );
    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: '/wallet',
      params: { action: 'bank-transfer' },
    });
    expect(screen.queryByText(/store credit/i)).toBeNull();
  });

  it('sends a PiggyVest customer to a card store credit top-up, not their PiggyVest account', () => {
    render(<UtilityWalletTransferNudge {...baseProps} walletIsStoreCredit />);

    expect(screen.getByText(/Not enough store credit/)).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Add store credit' }));
    expect(mockRouterPush).toHaveBeenCalledWith(
      `/wallet?action=fund&requiredAmount=1000&returnTo=${encodeURIComponent(RETURN_TO)}`
    );
  });

  it('shows no bank transfer nudge to a PiggyVest customer without a return link', () => {
    render(
      <UtilityWalletTransferNudge
        {...baseProps}
        returnToHref={undefined}
        walletIsStoreCredit
      />
    );

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('still offers store credit when bank-transfer funding is off', () => {
    render(
      <UtilityWalletTransferNudge
        {...baseProps}
        canFundByBankTransfer={false}
        walletIsStoreCredit
      />
    );

    expect(
      screen.getByRole('button', { name: 'Add store credit' })
    ).toBeOnTheScreen();
  });
});
