import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { WalletPinPad } from './WalletPinPad';

// The pad and dots are pure UI: they call no server, so they work the same
// whether or not the server has PiggyVest on.
describe('WalletPinPad', () => {
  it('adds digits up to six and deletes the last one', () => {
    const onChange = jest.fn();
    const view = render(
      <WalletPinPad
        colors={Colors.light}
        disabled={false}
        onChange={onChange}
        value="12"
      />
    );
    fireEvent.press(screen.getByRole('button', { name: '7' }));
    expect(onChange).toHaveBeenLastCalledWith('127');
    fireEvent.press(screen.getByRole('button', { name: 'Delete digit' }));
    expect(onChange).toHaveBeenLastCalledWith('1');

    onChange.mockClear();
    view.rerender(
      <WalletPinPad
        colors={Colors.light}
        disabled={false}
        onChange={onChange}
        value="123456"
      />
    );
    fireEvent.press(screen.getByRole('button', { name: '9' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('ignores taps while the PIN is being checked', () => {
    const onChange = jest.fn();
    render(
      <WalletPinPad
        colors={Colors.light}
        disabled
        onChange={onChange}
        value=""
      />
    );
    fireEvent.press(screen.getByRole('button', { name: '1' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
