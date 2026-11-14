import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { WalletPinSavedView } from './WalletPinSavedView';

describe('PIN saved state with the server off', () => {
  it('confirms calmly and only leaves when Done is tapped', () => {
    const onDone = jest.fn();
    render(
      <WalletPinSavedView
        colors={Colors.dark}
        title="PIN changed"
        onDone={onDone}
      />
    );
    expect(screen.getByRole('header', { name: 'PIN changed' })).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
    fireEvent.press(screen.getByRole('button', { name: 'Done' }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
