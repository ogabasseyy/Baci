import { jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { WalletFundPanel } from './WalletFundPanel';

const creditWatch = {
  armCheck: jest.fn(),
  creditedAmount: null,
  reset: jest.fn(),
  returnCtaHref: undefined,
  status: 'idle' as const,
};

function renderCardEntry(fundAmount = '5000') {
  const onChangeFundAmount = jest.fn();
  render(
    <WalletFundPanel
      canCreateFundingAccount={false}
      colors={Colors.dark}
      creditWatch={creditWatch}
      fundAmount={fundAmount}
      fundingAccount={null}
      isCreatingFundingAccount={false}
      isFundPending={false}
      needsPhone={false}
      onChangeFundAmount={onChangeFundAmount}
      onConfirmFund={jest.fn()}
      onCreateFundingAccount={jest.fn()}
      onResetFund={jest.fn()}
      onSubmitPhone={jest.fn(async () => ({ success: true }))}
    />
  );
  return { onChangeFundAmount };
}

describe('bugfix: Add Money card popup design', () => {
  it('shows a formatted naira amount and a payment action for a prefilled top-up', () => {
    const { onChangeFundAmount } = renderCardEntry();

    expect(screen.getByLabelText('Wallet top-up amount').props.value).toBe(
      '5,000'
    );
    expect(screen.getByText('₦')).toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: 'Continue to payment' })
    ).toBeOnTheScreen();

    fireEvent.changeText(
      screen.getByLabelText('Wallet top-up amount'),
      '12,500'
    );
    expect(onChangeFundAmount).toHaveBeenCalledWith('12500');
  });

  it('shows an empty amount with minimum guidance for a new card top-up', () => {
    renderCardEntry('');

    expect(
      screen.getByLabelText('Wallet top-up amount').props.placeholder
    ).toBe('0');
    expect(screen.getByText(/minimum ₦100/i)).toBeOnTheScreen();
  });
});
