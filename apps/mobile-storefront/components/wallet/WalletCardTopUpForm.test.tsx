import { jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { isHostedStagingWalletTopUpBlocked } from '@/lib/is-hosted-staging-wallet-top-up-blocked';
import { WalletCardTopUpForm } from './WalletCardTopUpForm';

jest.mock('@/lib/is-hosted-staging-wallet-top-up-blocked', () => ({
  isHostedStagingWalletTopUpBlocked: jest.fn(() => false),
}));

function renderForm(isFundPending = false, fundAmount = '12500') {
  const onConfirmFund = jest.fn();
  render(
    <WalletCardTopUpForm
      colors={Colors.dark}
      fundAmount={fundAmount}
      isFundPending={isFundPending}
      onChangeFundAmount={jest.fn()}
      onConfirmFund={onConfirmFund}
    />
  );
  return onConfirmFund;
}

describe('WalletCardTopUpForm', () => {
  beforeEach(() => {
    jest.mocked(isHostedStagingWalletTopUpBlocked).mockReturnValue(false);
  });

  it('shows a formatted amount and continues to payment', () => {
    const onConfirmFund = renderForm();

    expect(screen.getByLabelText('Wallet top-up amount').props.value).toBe(
      '12,500'
    );
    fireEvent.press(
      screen.getByRole('button', { name: 'Continue to payment' })
    );
    expect(onConfirmFund).toHaveBeenCalledTimes(1);
  });

  it('keeps the payment action visible but disabled during hosted staging', () => {
    jest.mocked(isHostedStagingWalletTopUpBlocked).mockReturnValue(true);
    const onConfirmFund = renderForm();

    const button = screen.getByRole('button', { name: 'Continue to payment' });
    expect(button).toHaveAccessibilityState({ disabled: true });
    expect(
      screen.getByText(/unavailable in this hosted staging preview/i)
    ).toBeOnTheScreen();
    fireEvent.press(button);
    expect(onConfirmFund).not.toHaveBeenCalled();
  });

  it('disables repeated payment submission while pending', () => {
    const onConfirmFund = renderForm(true);

    const button = screen.getByRole('button', { name: 'Continue to payment' });
    expect(button).toHaveAccessibilityState({ disabled: true, busy: true });
    fireEvent.press(button);
    expect(onConfirmFund).not.toHaveBeenCalled();
  });

  it('prevents payment submission below the minimum top-up amount', () => {
    const onConfirmFund = renderForm(false, '99');

    const button = screen.getByRole('button', { name: 'Continue to payment' });
    expect(button).toHaveAccessibilityState({ disabled: true });
    fireEvent.press(button);
    expect(onConfirmFund).not.toHaveBeenCalled();
  });
});
