import { fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { PhoneInput } from './PhoneInput';

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'dark',
}));

describe('PhoneInput', () => {
  function renderControlledPhoneInput(initialValue = '') {
    function Harness() {
      const [value, setValue] = useState(initialValue);
      return <PhoneInput value={value} onChangeText={setValue} />;
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

  it('normalizes a pasted Nigerian international number without duplicating the country code', () => {
    renderControlledPhoneInput();

    fireEvent.changeText(
      screen.getByLabelText('Phone number'),
      '+2349169449282'
    );

    expect(screen.getByDisplayValue('9169449282')).toBeTruthy();
  });

  it('normalizes a pasted Nigerian local number to the same national value', () => {
    renderControlledPhoneInput();

    fireEvent.changeText(screen.getByLabelText('Phone number'), '09169449282');

    expect(screen.getByDisplayValue('9169449282')).toBeTruthy();
  });

  it('preserves all digits when a formatted Nigerian number is pasted', () => {
    renderControlledPhoneInput();

    fireEvent.changeText(
      screen.getByLabelText('Phone number'),
      '+234 916 944 9282'
    );

    expect(screen.getByDisplayValue('9169449282')).toBeTruthy();
  });
});
