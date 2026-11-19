import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { OxygenIncomeStep } from './OxygenIncomeStep';

jest.mock('./OxygenHomeAddress', () => ({ OxygenHomeAddress: () => null }));
const props = {
  fields: {},
  onChange: jest.fn(),
  consent: false,
  onConsent: jest.fn(),
  proof: null,
  onPickProof: jest.fn(),
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

it('groups utility proof with the home address and opens the picker', () => {
  render(<OxygenIncomeStep {...props} fields={completedIncome} />);
  expect(screen.getByText('Your home address')).toBeTruthy();
  expect(screen.getByText('Utility bill / proof of address')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Choose photo' }));
  expect(props.onPickProof).toHaveBeenCalledWith('photos');
  fireEvent.press(screen.getByRole('button', { name: 'Choose file' }));
  expect(props.onPickProof).toHaveBeenCalledWith('files');
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

it('prevents changes and proof selection while submitting', () => {
  render(<OxygenIncomeStep {...props} fields={completedIncome} busy />);
  expect(screen.getByRole('button', { name: 'Choose photo' })).toBeDisabled();
  expect(screen.getByRole('checkbox')).toBeDisabled();
});

it('shows a selected photo as ready while an unrelated workflow refresh is busy', () => {
  render(
    <OxygenIncomeStep
      {...props}
      fields={completedIncome}
      busy
      proof={{
        name: 'proof.png',
        type: 'image/png',
        size: 8,
        bytes: new Uint8Array(8),
      }}
    />
  );
  expect(screen.getByText('Ready to upload')).toBeTruthy();
  expect(screen.queryByText('Reading document…')).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Change photo' }).props
      .accessibilityState.disabled
  ).toBe(true);
});

it('reveals address after income is completed and keeps it visible while editing', () => {
  const view = render(<OxygenIncomeStep {...props} />);
  expect(screen.queryByText('Your home address')).toBeNull();
  view.rerender(<OxygenIncomeStep {...props} fields={completedIncome} />);
  expect(screen.getByText('Your home address')).toBeTruthy();
  view.rerender(
    <OxygenIncomeStep
      {...props}
      fields={{ ...completedIncome, salary_amount: '' }}
    />
  );
  expect(screen.getByText('Your home address')).toBeTruthy();
});
