import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { WalletBalancePreview } from './WalletBalancePreview';

const wallet = {
  balance: 100,
  total_balance: 300,
  savings_balance: 200,
  loyalty_points: 10,
  earnings_available: true,
  earnings_balance: 7.33,
};
it('shows confirmed totals before details without exposing funding or redemption actions', () => {
  render(<WalletBalancePreview wallet={wallet} colors={Colors.dark} />);
  expect(screen.getByText('₦300')).toBeOnTheScreen();
  expect(screen.getByText('₦200')).toBeOnTheScreen();
  expect(screen.getByText('₦7.33')).toBeOnTheScreen();
  expect(screen.getByRole('progressbar')).toBeOnTheScreen();
  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.queryByText('No transactions yet')).toBeNull();
});
it('keeps confirmed amounts and offers retry when details fail', () => {
  const retry = jest.fn();
  render(
    <WalletBalancePreview
      wallet={wallet}
      colors={Colors.dark}
      isError
      onRetry={retry}
    />
  );
  expect(screen.getByText('₦300')).toBeOnTheScreen();
  expect(screen.queryByRole('progressbar')).toBeNull();
  fireEvent.press(screen.getByRole('button'));
  expect(retry).toHaveBeenCalledTimes(1);
});

it('does not present principal-only savings as a confirmed total when earnings are unavailable', () => {
  render(
    <WalletBalancePreview
      wallet={{ ...wallet, earnings_available: false }}
      colors={Colors.dark}
    />
  );
  expect(screen.getAllByText('—')).toHaveLength(3);
  expect(screen.queryByText('₦300')).toBeNull();
  expect(screen.queryByText('₦200')).toBeNull();
});

it('fails closed for a legacy cached wallet without earnings availability', () => {
  const { earnings_available: _earningsAvailable, ...legacyWallet } = wallet;
  render(<WalletBalancePreview wallet={legacyWallet} colors={Colors.dark} />);
  expect(screen.getAllByText('—')).toHaveLength(3);
  expect(screen.queryByText('₦300')).toBeNull();
  expect(screen.queryByText('₦200')).toBeNull();
});
