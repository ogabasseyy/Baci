import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { WalletPinDots } from './WalletPinDots';

// Pure UI: no server call, so it is the same whether PiggyVest is on or off.
describe('WalletPinDots', () => {
  it('announces only how many digits are entered, never the digits', () => {
    render(<WalletPinDots colors={Colors.light} label="PIN" length={3} />);
    expect(
      screen.getByLabelText('PIN, 3 of 6 digits entered')
    ).toBeOnTheScreen();
  });

  it('shows a fixed number of boxes for a code of known length', () => {
    render(
      <WalletPinDots
        colors={Colors.light}
        label="Code"
        length={2}
        fixedSlots={6}
      />
    );
    expect(
      screen.getByLabelText('Code, 2 of 6 digits entered')
    ).toBeOnTheScreen();
  });
});
