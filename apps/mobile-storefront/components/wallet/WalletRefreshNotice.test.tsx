import { fireEvent, render, screen } from '@testing-library/react-native';
import { WalletRefreshNotice } from './WalletRefreshNotice';

it('does not add a notice to a successfully refreshed balance', () => {
  render(<WalletRefreshNotice />);
  expect(screen.queryByText(/balance/)).toBeNull();
});

it('keeps failed refreshes clearly distinct from a confirmed current balance and offers retry', () => {
  const onRetry = jest.fn();
  render(<WalletRefreshNotice state="error" onRetry={onRetry} />);
  expect(
    screen.getByText('Couldn’t refresh · Last saved balance')
  ).toBeOnTheScreen();
  fireEvent.press(screen.getByRole('button', { name: 'Retry wallet refresh' }));
  expect(onRetry).toHaveBeenCalledTimes(1);
});

it('labels offline balances without claiming to be updating', () => {
  render(<WalletRefreshNotice state="offline" />);
  expect(screen.getByText('Offline · Last saved balance')).toBeOnTheScreen();
  expect(screen.queryByText('Updating balance…')).toBeNull();
});
