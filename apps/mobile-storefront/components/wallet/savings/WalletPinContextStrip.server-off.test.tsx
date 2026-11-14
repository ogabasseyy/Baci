import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { WalletPinContextStrip } from './WalletPinContextStrip';

// Pure UI: no server call, so it is the same whether PiggyVest is on or off.
describe('WalletPinContextStrip', () => {
  it('shows what the PIN is for', () => {
    render(
      <WalletPinContextStrip
        colors={Colors.light}
        text="Adding ₦100 to savings"
      />
    );
    expect(screen.getByText('Adding ₦100 to savings')).toBeTruthy();
  });
});
