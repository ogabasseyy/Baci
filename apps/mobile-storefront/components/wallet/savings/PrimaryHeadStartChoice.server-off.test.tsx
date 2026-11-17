import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { PrimaryHeadStartChoice } from './PrimaryHeadStartChoice';

const account = {
  account_name: 'Synthetic Customer',
  account_number: '0000000001',
  bank_name: 'Test Bank',
  provider: 'piggyvest',
} as const;

function renderChoice(
  overrides: Partial<Parameters<typeof PrimaryHeadStartChoice>[0]> = {}
) {
  const onPayNowChange = jest.fn();
  render(
    <PrimaryHeadStartChoice
      colors={Colors.dark}
      headStart={100}
      walletBalance={220}
      fundingAccount={account}
      payNow
      disabled={false}
      onPayNowChange={onPayNowChange}
      {...overrides}
    />
  );
  return onPayNowChange;
}

describe('PrimaryHeadStartChoice with PiggyVest off', () => {
  it('offers to pay the head start now, showing the wallet balance', () => {
    const onPayNowChange = renderChoice();
    const tick = screen.getByRole('checkbox', {
      name: 'Pay ₦100 head start now from my wallet',
    });
    expect(tick.props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByText(/₦220 available/)).toBeOnTheScreen();
    expect(screen.queryByText('0000000001')).toBeNull();
    fireEvent.press(tick);
    expect(onPayNowChange).toHaveBeenCalledWith(false);
  });

  it('shows the wallet account number when the balance is short', () => {
    renderChoice({ walletBalance: 40 });
    expect(screen.getByRole('alert')).toHaveTextContent(
      /Your wallet showed ₦40 when you opened this\. Send at least ₦60/
    );
    expect(screen.getByText('0000000001')).toBeOnTheScreen();
    expect(screen.getByText('Test Bank')).toBeOnTheScreen();
  });

  it('says the head start can be added later when unticked', () => {
    const onPayNowChange = renderChoice({ payNow: false, walletBalance: 0 });
    expect(
      screen.getByText('You can add it later from your wallet.')
    ).toBeOnTheScreen();
    expect(screen.queryByText('0000000001')).toBeNull();
    fireEvent.press(screen.getByRole('checkbox'));
    expect(onPayNowChange).toHaveBeenCalledWith(true);
  });
});
