import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { PlanTransferActions } from './PlanTransferActions';

// Both actions are wallet actions that exist in production: the wallet
// funding screen and recording a wallet contribution.
describe('server keeps PiggyVest off', () => {
  it('opens wallet funding and records a wallet contribution', () => {
    const controller = {
      isSubmitting: false,
      openWalletFundingScreen: jest.fn(),
    };
    const onContributeFromWallet = jest.fn();
    render(
      <PlanTransferActions
        colors={Colors.light}
        controller={controller as never}
        onContributeFromWallet={onContributeFromWallet}
      />
    );
    fireEvent.press(
      screen.getByRole('button', { name: 'Open wallet funding screen' })
    );
    fireEvent.press(
      screen.getByRole('button', { name: 'Record wallet contribution' })
    );
    expect(controller.openWalletFundingScreen).toHaveBeenCalledTimes(1);
    expect(onContributeFromWallet).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/PiggyVest/i)).toBeNull();
  });

  it('disables recording while a submission is running', () => {
    const onContributeFromWallet = jest.fn();
    render(
      <PlanTransferActions
        colors={Colors.light}
        controller={
          { isSubmitting: true, openWalletFundingScreen: jest.fn() } as never
        }
        onContributeFromWallet={onContributeFromWallet}
      />
    );
    fireEvent.press(
      screen.getByRole('button', { name: 'Record wallet contribution' })
    );
    expect(onContributeFromWallet).not.toHaveBeenCalled();
  });
});
