import { fireEvent, screen } from '@testing-library/react-native';

/** Taps a button by its spoken name. */
export const pressButton = (name: string) =>
  fireEvent.press(screen.getByRole('button', { name }));

/** Types digits on the on-screen PIN pad, one key at a time. */
export function enterPin(digits: string) {
  for (const digit of digits) pressButton(digit);
}

/** Types a PIN on the current step, then taps that step's button. */
export function enterStep(digits: string, button = 'Continue') {
  enterPin(digits);
  pressButton(button);
}
