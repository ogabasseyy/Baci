import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { WalletFundModal } from './WalletFundModal';
import { createWalletContentProps } from './wallet-content.test-utils';

const creditWatch = {
  armCheck: jest.fn(),
  creditedAmount: null,
  reset: jest.fn(),
  returnCtaHref: undefined,
  status: 'idle' as const,
};

describe('WalletFundModal', () => {
  it('shows savings return guidance when funding an existing plan', () => {
    const props = createWalletContentProps();
    render(
      <WalletFundModal
        {...props}
        creditWatch={creditWatch}
        fundReturnTo="/wallet?action=savings"
        showFundPanel
      />
    );

    expect(screen.getByText(/return to this savings plan/i)).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Close add money' }));
    expect(props.onResetFund).toHaveBeenCalledTimes(1);
  });

  it('does not show a funding panel when it is closed', () => {
    const props = createWalletContentProps();
    render(
      <WalletFundModal
        {...props}
        creditWatch={creditWatch}
        showFundPanel={false}
      />
    );

    expect(screen.queryByText('Add Money')).toBeNull();
  });

  it('keeps the Add Money payment sheet above the keyboard', () => {
    const props = createWalletContentProps();
    render(
      <WalletFundModal
        {...props}
        creditWatch={creditWatch}
        fundAmount="5000"
        showFundPanel
      />
    );

    expect(screen.getByTestId('keyboard-container')).toHaveProp(
      'automaticOffset',
      true
    );
    expect(
      screen.getByRole('button', { name: 'Continue to payment' })
    ).toBeOnTheScreen();
  });
});
