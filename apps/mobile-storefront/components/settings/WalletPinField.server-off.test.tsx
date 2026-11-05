import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { WalletPinField } from './WalletPinField';

describe('WalletPinField', () => {
  it('is masked, digits only and capped at 6, with no autofill', () => {
    const onChange = jest.fn();
    render(
      <WalletPinField
        colors={Colors.light}
        label="New PIN"
        value=""
        editable
        onChange={onChange}
      />
    );
    const input = screen.getByLabelText('New PIN');
    expect(input.props.secureTextEntry).toBe(true);
    expect(input.props.keyboardType).toBe('number-pad');
    expect(input.props.maxLength).toBe(6);
    expect(input.props.autoComplete).toBe('off');
    expect(input.props.textContentType).toBe('none');
    expect(input.props.importantForAutofill).toBe('no');
    fireEvent.changeText(input, '12ab34567');
    expect(onChange).toHaveBeenCalledWith('123456');
  });
});
