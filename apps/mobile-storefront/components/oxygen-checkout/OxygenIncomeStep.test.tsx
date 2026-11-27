import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { OxygenIncomeStep } from './OxygenIncomeStep';

jest.mock('./OxygenHomeAddress', () => ({ OxygenHomeAddress: () => null }));
const props = {
  fields: {},
  onChange: jest.fn(),
  consent: false,
  onConsent: jest.fn(),
};
const completedIncome = {
  employment_status: 'EMPLOYED',
  name_of_employer: 'Test company',
  salary_amount: '250000',
  salary_date: '21',
};
beforeEach(() => jest.clearAllMocks());

it('selects employment and a labelled monthly payday, retaining provider values', () => {
  render(<OxygenIncomeStep {...props} />);
  fireEvent.press(screen.getByRole('combobox', { name: 'Employment status' }));
  fireEvent.press(screen.getByRole('radio', { name: 'Self-employed' }));
  expect(props.onChange).toHaveBeenCalledWith({
    employment_status: 'SELF_EMPLOYED',
  });
  fireEvent.press(screen.getByRole('combobox', { name: 'When are you paid?' }));
  fireEvent.press(screen.getByRole('radio', { name: '21st of every month' }));
  expect(props.onChange).toHaveBeenCalledWith({ salary_date: '21' });
});

it('formats income for display while passing unformatted money to the draft', () => {
  render(
    <OxygenIncomeStep {...props} fields={{ salary_amount: '250000.50' }} />
  );
  expect(screen.getByDisplayValue('250,000.50')).toBeTruthy();
  fireEvent.changeText(
    screen.getByLabelText('Monthly income (₦)'),
    '300,000.25'
  );
  expect(props.onChange).toHaveBeenCalledWith({ salary_amount: '300000.25' });
  fireEvent.changeText(screen.getByLabelText('Monthly income (₦)'), '30.123');
  expect(props.onChange).toHaveBeenCalledTimes(1);
});

it('renders consent on step 2 without upfront residential address or utility bill', () => {
  render(<OxygenIncomeStep {...props} fields={completedIncome} />);
  expect(screen.queryByText('Your home address')).toBeNull();
  expect(screen.queryByText('Utility bill / proof of address')).toBeNull();
  expect(screen.getByRole('checkbox')).toBeTruthy();
});

it('shows an inline alert when consentError is passed', () => {
  render(
    <OxygenIncomeStep
      {...props}
      fields={completedIncome}
      consentError="Accept Oxygen’s terms to continue."
    />
  );
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Accept Oxygen’s terms to continue.'
  );
});

it('keeps terms separate from explicit consent', async () => {
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  render(<OxygenIncomeStep {...props} fields={completedIncome} />);
  const stopPropagation = jest.fn();
  fireEvent.press(screen.getByRole('link', { name: 'Read Oxygen’s terms' }), {
    stopPropagation,
  });
  expect(stopPropagation).toHaveBeenCalledTimes(1);
  expect(open).toHaveBeenCalledWith(
    'https://www.oxygenx.africa/terms-of-service'
  );
  expect(props.onConsent).not.toHaveBeenCalled();
  fireEvent.press(
    screen.getByText(
      /I agree to share these details with Oxygen for this finance/
    )
  );
  expect(props.onConsent).toHaveBeenCalledWith(true);
  open.mockRestore();
});

it('disables consent toggle while submitting', () => {
  render(<OxygenIncomeStep {...props} fields={completedIncome} busy />);
  expect(screen.getByRole('checkbox')).toBeDisabled();
});
