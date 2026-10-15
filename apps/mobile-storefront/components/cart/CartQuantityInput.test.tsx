import { fireEvent, render, screen } from '@testing-library/react-native';
import CartQuantityInput from './CartQuantityInput';

describe('CartQuantityInput', () => {
  it('filters non-digit characters in onChangeText', () => {
    const onChange = jest.fn();

    render(<CartQuantityInput value={2} onChange={onChange} />);

    const input = screen.getByLabelText('Quantity input');
    fireEvent.changeText(input, 'a1b2c');

    expect(screen.getByDisplayValue('12')).toBeTruthy();
  });

  it('calls onChange on end editing and resets to prop value on invalid end editing', () => {
    const onChange = jest.fn();

    render(<CartQuantityInput value={3} onChange={onChange} />);

    const input = screen.getByLabelText('Quantity input');

    fireEvent.changeText(input, '15');
    fireEvent(input, 'endEditing');
    expect(onChange).toHaveBeenCalledWith(15);
    expect(onChange).toHaveBeenCalledTimes(1);

    fireEvent.changeText(input, '');
    fireEvent(input, 'endEditing');
    expect(screen.getByDisplayValue('3')).toBeTruthy();
    expect(onChange).toHaveBeenCalledTimes(1);

    fireEvent.changeText(input, '0');
    fireEvent(input, 'endEditing');
    expect(screen.getByDisplayValue('3')).toBeTruthy();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('clamps committed values to maxValue when provided', () => {
    const onChange = jest.fn();

    render(<CartQuantityInput value={3} onChange={onChange} maxValue={10} />);

    const input = screen.getByLabelText('Quantity input');
    fireEvent.changeText(input, '99');
    fireEvent(input, 'endEditing');

    expect(onChange).toHaveBeenCalledWith(10);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('does not commit on blur alone', () => {
    const onChange = jest.fn();

    render(<CartQuantityInput value={4} onChange={onChange} />);

    const input = screen.getByLabelText('Quantity input');

    fireEvent.changeText(input, '9');
    fireEvent(input, 'blur');

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('9')).toBeTruthy();
  });

  it('syncs local input value when external value prop changes', () => {
    const onChange = jest.fn();
    const { rerender } = render(
      <CartQuantityInput value={1} onChange={onChange} />
    );

    expect(screen.getByDisplayValue('1')).toBeTruthy();

    rerender(<CartQuantityInput value={7} onChange={onChange} />);

    expect(screen.getByDisplayValue('7')).toBeTruthy();
  });
});
