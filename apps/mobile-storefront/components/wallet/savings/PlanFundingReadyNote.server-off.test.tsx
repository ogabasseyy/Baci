import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { SERVER_OFF_ACCOUNT_NUMBER } from '@/test-support/piggyvest-server-off.test-support';
import { PlanFundingReadyNote } from './PlanFundingReadyNote';

// The note never carries a plan account number, whatever the server says.
describe('server keeps PiggyVest off', () => {
  it('points to the wallet and shows no account number', () => {
    render(<PlanFundingReadyNote colors={Colors.light} />);
    expect(
      screen.getByText(/Fund it by moving money from your wallet/)
    ).toBeOnTheScreen();
    expect(screen.queryByText(SERVER_OFF_ACCOUNT_NUMBER)).toBeNull();
    expect(screen.queryByText(/\d{10}/)).toBeNull();
  });
});
