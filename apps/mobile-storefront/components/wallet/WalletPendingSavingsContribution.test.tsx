import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { WalletPendingSavingsContribution } from './WalletPendingSavingsContribution';

describe('WalletPendingSavingsContribution', () => {
  it('checks the existing contribution rather than offering another payment', () => {
    const onCheck = jest.fn();
    render(
      <WalletPendingSavingsContribution
        colors={Colors.dark}
        isChecking={false}
        onCheck={onCheck}
      />
    );
    fireEvent.press(
      screen.getByRole('button', { name: 'Check contribution status' })
    );
    expect(onCheck).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Continue to payment')).toBeNull();
  });

  it('disables status checks while a check is running', () => {
    render(
      <WalletPendingSavingsContribution
        colors={Colors.light}
        isChecking
        onCheck={jest.fn()}
      />
    );
    expect(
      screen.getByRole('button', { name: 'Check contribution status' })
    ).toHaveAccessibilityState({ disabled: true });
  });
});
