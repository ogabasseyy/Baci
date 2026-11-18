import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { PaymentMethodStoreCreditRows } from './PaymentMethodStoreCreditRows';

const baseProps = {
  colors: Colors.light,
  savingsAccessibilityLabel: '',
  savingsCoversFully: false,
  savingsGoalDisplayName: '',
  savingsIsActive: false,
  savingsPortion: 0,
  savingsResidualToGateway: 0,
  savingsShouldRender: false,
  savingsTotalBalance: 0,
  walletCoversFully: true,
  walletEffectiveTotal: 1000,
  walletInfoShouldRender: false,
  walletIsActive: false,
  walletIsLoading: false,
  walletPortion: 1000,
  walletResidualToCard: 0,
  walletShouldRender: true,
  walletStatusShouldRender: false,
  walletTotalBalance: 1500,
};

describe('store credit rows', () => {
  it('keeps "Pay with wallet" when the server keeps PiggyVest off', () => {
    render(<PaymentMethodStoreCreditRows {...baseProps} />);

    expect(
      screen.getByRole('radio', { name: 'Pay with wallet, ₦1,500 available' })
    ).toBeOnTheScreen();
  });

  it('says "Pay with store credit" for a PiggyVest customer', () => {
    render(<PaymentMethodStoreCreditRows {...baseProps} walletIsStoreCredit />);

    expect(
      screen.getByRole('radio', {
        name: 'Pay with store credit, ₦1,500 available',
      })
    ).toBeOnTheScreen();
    expect(screen.getByText('Pay with store credit')).toBeOnTheScreen();
  });
});
