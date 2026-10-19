import {
  fireEvent,
  render,
  screen,
  userEvent,
} from '@testing-library/react-native';
import { useState } from 'react';
import { Text } from 'react-native';
import { PhoneInput } from './PhoneInput';

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'dark',
}));

describe('PhoneInput', () => {
  function renderControlledPhoneInput(
    initialValue = '',
    defaultCountry = 'NG'
  ) {
    function Harness() {
      const [value, setValue] = useState(initialValue);
      return (
        <>
          <Text testID="phone-form-value">{value}</Text>
          <PhoneInput
            value={value}
            onChangeText={setValue}
            defaultCountry={defaultCountry}
          />
        </>
      );
    }

    return render(<Harness />);
  }

  it('uses the expected default placeholder when none is provided', () => {
    render(<PhoneInput value="" onChangeText={() => {}} />);

    expect(screen.getByPlaceholderText('8012345678')).toBeTruthy();
  });

  it('allows callers to override the placeholder', () => {
    render(
      <PhoneInput value="" onChangeText={() => {}} placeholder="8123456789" />
    );

    expect(screen.getByPlaceholderText('8123456789')).toBeTruthy();
    expect(screen.queryByPlaceholderText('8012345678')).toBeNull();
  });

  it('defaults the return key to next for chained form flows', () => {
    render(<PhoneInput value="" onChangeText={() => {}} />);

    expect(screen.getByLabelText('Phone number').props.returnKeyType).toBe(
      'next'
    );
  });

  it('allows callers to override the return key type', () => {
    render(
      <PhoneInput value="" onChangeText={() => {}} returnKeyType="done" />
    );

    expect(screen.getByLabelText('Phone number').props.returnKeyType).toBe(
      'done'
    );
  });

  it('echoes autofilled text unchanged while focused and keeps normalized form data', () => {
    renderControlledPhoneInput();
    const input = screen.getByLabelText('Phone number');
    fireEvent(input, 'focus');
    fireEvent.changeText(input, '+234 916 944 9282');
    expect(input.props.value).toBe('+234 916 944 9282');
    expect(screen.getByTestId('phone-form-value')).toHaveTextContent(
      '+2349169449282'
    );
    fireEvent(input, 'blur');
    expect(input.props.value).toBe('9169449282');
  });

  it('accepts every permitted digit when a non-Nigerian number contains separators', async () => {
    renderControlledPhoneInput('', 'US');
    const user = userEvent.setup();
    const input = screen.getByLabelText('Phone number');
    await user.type(input, '202 555 0123', { skipBlur: true });
    expect(screen.getByTestId('phone-form-value')).toHaveTextContent(
      '+12025550123'
    );
    expect(input.props.value).toBe('202 555 0123');
    fireEvent(input, 'blur');
    expect(input.props.value).toBe('2025550123');
  });

  it('caps normalized digits without rewriting an overlong draft while editing', () => {
    renderControlledPhoneInput('', 'US');
    const input = screen.getByLabelText('Phone number');
    fireEvent.changeText(input, '202 555 0123 99');
    expect(input.props.value).toBe('202 555 0123 99');
    expect(screen.getByTestId('phone-form-value')).toHaveTextContent(
      '+12025550123'
    );
    fireEvent(input, 'blur');
    expect(input.props.value).toBe('2025550123');
  });

  it('normalizes a pasted Nigerian international number without duplicating the country code', () => {
    renderControlledPhoneInput();

    fireEvent.changeText(
      screen.getByLabelText('Phone number'),
      '+2349169449282'
    );

    expect(screen.getByTestId('phone-form-value')).toHaveTextContent(
      '+2349169449282'
    );
    fireEvent(screen.getByLabelText('Phone number'), 'blur');
    expect(screen.getByDisplayValue('9169449282')).toBeTruthy();
  });

  it('normalizes a pasted Nigerian local number to the same national value', () => {
    renderControlledPhoneInput();

    fireEvent.changeText(screen.getByLabelText('Phone number'), '09169449282');

    expect(screen.getByTestId('phone-form-value')).toHaveTextContent(
      '+2349169449282'
    );
    fireEvent(screen.getByLabelText('Phone number'), 'blur');
    expect(screen.getByDisplayValue('9169449282')).toBeTruthy();
  });

  it('preserves all digits when a formatted Nigerian number is pasted', () => {
    renderControlledPhoneInput();

    fireEvent.changeText(
      screen.getByLabelText('Phone number'),
      '+234 916 944 9282'
    );

    expect(screen.getByTestId('phone-form-value')).toHaveTextContent(
      '+2349169449282'
    );
    fireEvent(screen.getByLabelText('Phone number'), 'blur');
    expect(screen.getByDisplayValue('9169449282')).toBeTruthy();
  });
});
