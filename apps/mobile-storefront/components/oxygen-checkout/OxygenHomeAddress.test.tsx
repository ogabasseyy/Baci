import { fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { OxygenHomeAddress } from './OxygenHomeAddress';
import type { OxygenFields } from './oxygen-form-utils';

jest.mock('@/components/ui/AddressAutocomplete', () => ({
  AddressAutocomplete: ({
    value,
    onChangeText,
    onSelect,
  }: {
    value: string;
    onChangeText: (value: string) => void;
    onSelect: (value: unknown) => void;
  }) => {
    const { TextInput, Pressable, Text } = require('react-native');
    return (
      <>
        <TextInput
          accessibilityLabel="Find your home address"
          value={value}
          onChangeText={onChangeText}
        />
        <Pressable
          accessibilityRole="button"
          onPress={() => onSelect(mockPlace)}
        >
          <Text>Choose Google result</Text>
        </Pressable>
      </>
    );
  },
}));
const mockPlace = {
  streetNumber: '2',
  route: 'Example Road',
  city: 'Lagos',
  state: 'Lagos',
  lga: 'Ikeja',
  country: 'Nigeria',
  zip: '',
  formattedAddress: '2 Example Road, Ikeja, Lagos, Nigeria',
};
const address = {
  home_street: '2 Example Road',
  home_state: 'Lagos',
  home_city: 'Ikeja',
};

it('shows the checkout address as a summary with an edit control', () => {
  render(
    <OxygenHomeAddress
      fields={address}
      checkoutAddress={{ kind: 'delivery', fields: address }}
      onChange={jest.fn()}
    />
  );
  expect(screen.getByText('From your checkout')).toBeTruthy();
  expect(screen.getByText('2 Example Road, Ikeja, Lagos')).toBeTruthy();
  expect(screen.queryByLabelText('Street address')).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'Change address' }));
  expect(screen.getByLabelText('Find your home address')).toBeTruthy();
  fireEvent.press(
    screen.getByRole('button', { name: 'Enter address manually' })
  );
  expect(screen.getByLabelText('Street address').props.value).toBe(
    '2 Example Road'
  );
});

it('offers a partial delivery address without requiring checkout to have an LGA or house number', () => {
  const onChange = jest.fn();
  render(
    <OxygenHomeAddress
      fields={{}}
      checkoutAddress={{ kind: 'delivery', fields: address }}
      onChange={onChange}
    />
  );
  fireEvent.press(
    screen.getByRole('button', {
      name: 'Use delivery address as my home address',
    })
  );
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining(address));
});

it('does not offer a pickup destination as a residence', () => {
  render(
    <OxygenHomeAddress
      fields={{}}
      checkoutAddress={{ kind: 'pickup', fields: address }}
      onChange={jest.fn()}
    />
  );
  expect(screen.queryByText('From your checkout')).toBeNull();
  expect(
    screen.queryByRole('button', {
      name: 'Use delivery address as my home address',
    })
  ).toBeNull();
});

it('does not collapse manual editing as a street and state become complete', () => {
  const props = { fields: {}, onChange: jest.fn() };
  const view = render(<OxygenHomeAddress {...props} />);
  fireEvent.press(
    screen.getByRole('button', { name: 'Enter address manually' })
  );
  view.rerender(<OxygenHomeAddress {...props} fields={address} />);
  expect(screen.getByLabelText('Street address')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Change address' })).toBeNull();
});

function AddressEditor() {
  const [fields, setFields] = useState<OxygenFields>({});
  return (
    <OxygenHomeAddress
      fields={fields}
      onChange={(patch) => setFields((previous) => ({ ...previous, ...patch }))}
    />
  );
}

it('shows search alone, then a summary and only missing fields after Google selection', () => {
  render(<AddressEditor />);
  expect(screen.queryByLabelText('Street address')).toBeNull();
  expect(screen.queryByLabelText('State')).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'Choose Google result' }));
  expect(screen.queryByLabelText('Find your home address')).toBeNull();
  expect(screen.getByText('2, Example Road, Ikeja, Lagos')).toBeTruthy();
  expect(screen.queryByLabelText('House / flat number')).toBeNull();
  expect(screen.queryByLabelText('Local government area (LGA)')).toBeNull();
  const landmark = screen.getByLabelText('Nearby landmark');
  fireEvent.changeText(landmark, 'Near market');
  expect(screen.getByLabelText('Nearby landmark').props.value).toBe(
    'Near market'
  );
  expect(screen.getByRole('button', { name: 'Change address' })).toBeTruthy();
});

it('keeps address search text separate from saved residence details', () => {
  const onChange = jest.fn();
  render(<OxygenHomeAddress fields={{}} onChange={onChange} />);
  fireEvent.changeText(
    screen.getByLabelText('Find your home address'),
    'Search query'
  );
  expect(onChange).not.toHaveBeenCalled();
});
