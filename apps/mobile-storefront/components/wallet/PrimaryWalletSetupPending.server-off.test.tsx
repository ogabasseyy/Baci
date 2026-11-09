import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { PrimaryWalletSetupPending } from './PrimaryWalletSetupPending';

describe('PrimaryWalletSetupPending', () => {
  const base = {
    colors: Colors.light,
    checking: false,
    stillWaiting: false,
    checkFailed: false,
  };

  it('explains the wait and lets the customer check now', () => {
    const onCheckNow = jest.fn();
    render(<PrimaryWalletSetupPending {...base} onCheckNow={onCheckNow} />);

    expect(
      screen.getByText('Setting up your account number')
    ).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Check now' }));
    expect(onCheckNow).toHaveBeenCalledTimes(1);
  });

  it('reassures the customer when it is taking longer than usual', () => {
    render(
      <PrimaryWalletSetupPending
        {...base}
        stillWaiting
        onCheckNow={jest.fn()}
      />
    );
    expect(screen.getByText(/taking longer than usual/)).toBeOnTheScreen();
  });

  it('says when PiggyVest could not be reached', () => {
    render(
      <PrimaryWalletSetupPending {...base} checkFailed onCheckNow={jest.fn()} />
    );
    expect(screen.getByText(/couldn’t reach PiggyVest/)).toBeOnTheScreen();
  });
});
