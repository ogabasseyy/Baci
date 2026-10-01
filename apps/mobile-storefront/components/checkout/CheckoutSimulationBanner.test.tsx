import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { CheckoutSimulationBanner } from './CheckoutSimulationBanner';

describe('CheckoutSimulationBanner', () => {
  it('clearly states that the preview cannot create checkout mutations', () => {
    render(<CheckoutSimulationBanner colors={Colors.dark} />);

    expect(screen.getByRole('alert')).toBeOnTheScreen();
    expect(screen.getByText('TEST SIMULATION')).toBeOnTheScreen();
    expect(
      screen.getByText(/No order, payment, voucher, or inventory change/)
    ).toBeOnTheScreen();
  });
});
