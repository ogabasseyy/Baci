import { fireEvent, render, screen } from '@testing-library/react-native';
import { OxygenIdentityFields } from './OxygenIdentityFields';

it('shows checkout contact details once and lets the customer edit them', () => {
  render(
    <OxygenIdentityFields
      fields={{
        first_name: 'Test',
        last_name: 'Customer',
        email: 'customer@example.invalid',
      }}
      onChange={jest.fn()}
    />
  );
  expect(screen.getByText('Test Customer')).toBeTruthy();
  expect(screen.queryByLabelText('First name')).toBeNull();
  expect(screen.getByLabelText('BVN')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Edit name and email' }));
  expect(screen.getByLabelText('First name').props.value).toBe('Test');
  expect(screen.getByLabelText('Email').props.value).toBe(
    'customer@example.invalid'
  );
});
