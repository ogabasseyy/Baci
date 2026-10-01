import { fireEvent, screen } from '@testing-library/react-native';

export function fillCheckoutContact() {
  const firstNameInput = screen.queryByPlaceholderText('E.g. John');
  if (!firstNameInput) return;

  fireEvent.changeText(firstNameInput, 'Ada');
  fireEvent.changeText(screen.getByPlaceholderText('E.g. Doe'), 'Lovelace');
  fireEvent.changeText(
    screen.getByPlaceholderText('e.g. 08012345678'),
    '08031234567'
  );
  const emailInput = screen.getByPlaceholderText('john@example.com');
  fireEvent.changeText(emailInput, 'ada@example.com');
  fireEvent(emailInput, 'blur');
}
