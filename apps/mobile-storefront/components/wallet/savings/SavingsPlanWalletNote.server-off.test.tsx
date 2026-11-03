import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { SERVER_OFF_ACCOUNT_NUMBER } from '@/test-support/piggyvest-server-off.test-support';
import { SavingsPlanWalletNote } from './SavingsPlanWalletNote';

// The note is static guidance plus a local refresh: it calls no PiggyVest
// endpoint, shows no account and reports a failed refresh without a crash.
describe('server keeps PiggyVest off', () => {
  it('shows wallet guidance and no account number', () => {
    render(
      <SavingsPlanWalletNote colors={Colors.light} onRefresh={jest.fn()} />
    );
    expect(screen.getByText('Add from your wallet')).toBeOnTheScreen();
    expect(screen.queryByText(SERVER_OFF_ACCOUNT_NUMBER)).toBeNull();
    expect(screen.queryByText(/\d{10}/)).toBeNull();
    expect(screen.queryByText(/PiggyVest/)).toBeNull();
  });

  it('names PiggyVest only when the merchant is primary', () => {
    render(
      <SavingsPlanWalletNote
        colors={Colors.light}
        onRefresh={jest.fn()}
        primary
      />
    );
    expect(screen.getByText(/from your PiggyVest wallet/)).toBeOnTheScreen();
  });

  it('reports a failed wallet refresh', async () => {
    const onRefresh = jest.fn().mockRejectedValue(new Error('Wallet down'));
    render(
      <SavingsPlanWalletNote colors={Colors.light} onRefresh={onRefresh} />
    );
    fireEvent.press(
      screen.getByRole('button', { name: 'Refresh savings progress' })
    );
    expect(await screen.findByText('Wallet down')).toBeOnTheScreen();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
