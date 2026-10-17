import { jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { DataFormFooter } from './DataFormFooter';

describe('DataFormFooter', () => {
  it('renders the wallet pay action with the plan amount', () => {
    const onPress = jest.fn();

    render(
      <DataFormFooter
        bottomInset={0}
        bottomOffset={0}
        colors={Colors.light}
        isKeyboardVisible={false}
        isSubmitting={false}
        planAmount={3500}
        onPress={onPress}
      />
    );

    fireEvent.press(screen.getByText('Pay ₦3,500'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
