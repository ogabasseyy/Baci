import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { DataPhoneField } from './DataPhoneField';

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));

describe('DataPhoneField', () => {
  it('forwards typed text and shows no notice without an issue', () => {
    const onChangeText = jest.fn();
    render(
      <DataPhoneField
        colors={Colors.light}
        issue={null}
        onChangeText={onChangeText}
        value=""
      />
    );

    fireEvent.changeText(screen.getByLabelText('Phone Number'), '0803');
    expect(onChangeText).toHaveBeenCalledWith('0803');
    expect(screen.queryByText(/11-digit/)).toBeNull();
  });

  it('shows the issue under the field', () => {
    render(
      <DataPhoneField
        colors={Colors.light}
        issue="Enter an 11-digit phone number, like 08012345678."
        onChangeText={jest.fn()}
        value="12345678901"
      />
    );

    expect(screen.getByLabelText('Phone Number').props.value).toBe(
      '12345678901'
    );
    expect(
      screen.getByText('Enter an 11-digit phone number, like 08012345678.')
    ).toBeOnTheScreen();
  });
});
