import { fireEvent, screen } from '@testing-library/react-native';

export function getSavingsInput(name: string) {
  return screen.getByLabelText(name);
}

export function getSavingsButton(name: string) {
  return screen.getByRole('button', { name });
}

export function getSavingsRadio(name: string) {
  return screen.getByRole('radio', { name });
}

export function selectSavingsProduct(
  searchQuery = 'iPhone',
  buttonLabel = 'Select iPhone 13 Pro Max'
) {
  fireEvent.changeText(
    screen.getByRole('search', { name: 'Savings product search' }),
    searchQuery
  );
  fireEvent.press(getSavingsButton(buttonLabel));
}

export function setContributionAmount(amount = '20000') {
  fireEvent.changeText(getSavingsInput('Savings contribution amount'), amount);
}

export function acceptSavingsTerms() {
  fireEvent.press(
    screen.getByRole('checkbox', {
      name: 'Accept non-withdrawable savings terms',
    })
  );
}

/** Opens the single review step ("Check your plan"). */
export function openFundingOptions() {
  fireEvent.press(getSavingsButton('Continue savings setup'));
}
