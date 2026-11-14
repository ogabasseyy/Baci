import { act, fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { SavingsPlanWalletNote } from './SavingsPlanWalletNote';

it.each([
  'light',
  'dark',
] as const)('tells the customer to fund from the wallet, with no bank account (%s)', (theme) => {
  render(
    <SavingsPlanWalletNote
      colors={Colors[theme]}
      onRefresh={jest.fn().mockResolvedValue(undefined)}
    />
  );
  expect(screen.getByText('Add from your wallet')).toBeOnTheScreen();
  expect(screen.getByText(/do not send a bank transfer/i)).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: /copy/i })).toBeNull();
  expect(screen.queryByText(/\d{10}/)).toBeNull();
});

it('refreshes progress once while a refresh is in flight', async () => {
  let finish: () => void = () => undefined;
  const refresh = jest.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  render(<SavingsPlanWalletNote colors={Colors.dark} onRefresh={refresh} />);
  const button = screen.getByRole('button', {
    name: 'Refresh savings progress',
  });
  fireEvent.press(button);
  fireEvent.press(button);
  expect(refresh).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  expect(screen.getByText('Refresh progress')).toBeOnTheScreen();
});

it('shows a failed refresh without claiming anything was received', async () => {
  const refresh = jest
    .fn()
    .mockRejectedValue(new Error('Wallet refresh failed'));
  render(<SavingsPlanWalletNote colors={Colors.light} onRefresh={refresh} />);
  await act(async () => {
    fireEvent.press(
      screen.getByRole('button', { name: 'Refresh savings progress' })
    );
  });
  expect(screen.getByText('Wallet refresh failed')).toBeOnTheScreen();
  expect(screen.queryByText(/received|confirmed/i)).toBeNull();
});
