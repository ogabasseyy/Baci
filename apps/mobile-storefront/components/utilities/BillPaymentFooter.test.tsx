import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { BillPaymentFooter } from './BillPaymentFooter';

function renderFooter(numericAmount: number) {
  const onPurchase = jest.fn();
  render(
    <BillPaymentFooter
      colors={Colors.light}
      footerBottomOffset={0}
      insetsBottom={0}
      isBusy={false}
      isKeyboardVisible={false}
      numericAmount={numericAmount}
      onPurchase={onPurchase}
    />
  );
  return { button: screen.getByRole('button'), onPurchase };
}

describe('BillPaymentFooter', () => {
  it('disables Pay while the amount is empty', () => {
    const { button, onPurchase } = renderFooter(0);

    expect(button).toBeDisabled();
    fireEvent.press(button);
    expect(onPurchase).not.toHaveBeenCalled();
  });

  it('enables Pay once there is an amount', () => {
    const { button, onPurchase } = renderFooter(5000);

    expect(button).toBeEnabled();
    fireEvent.press(button);
    expect(onPurchase).toHaveBeenCalledTimes(1);
  });
});
