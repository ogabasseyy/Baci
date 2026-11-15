import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { UtilitySavingsMethod } from './UtilitySavingsMethod';

// Pure UI: it shows what it is given and calls no server, so it renders the
// same whether or not the server has paying from the savings wallet on.
describe('UtilitySavingsMethod', () => {
  it('shows the savings wallet as the method with its balance', () => {
    render(
      <UtilitySavingsMethod
        colors={Colors.light}
        balanceKobo={50_000}
        mode="pays"
      />
    );
    expect(screen.getByText('Payment Method')).toBeTruthy();
    expect(screen.getByText('Savings wallet · NGN')).toBeTruthy();
    expect(
      screen.getByText('₦500 available · covers this purchase')
    ).toBeTruthy();
  });

  it('bugfix: shows an earlier payment resuming without a live balance (Codex P2)', () => {
    render(
      <UtilitySavingsMethod
        colors={Colors.light}
        balanceKobo={null}
        mode="resumes"
      />
    );
    expect(screen.getByText('Finishing your earlier payment')).toBeTruthy();
  });
});
