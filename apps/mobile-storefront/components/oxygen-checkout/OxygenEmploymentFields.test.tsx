import { fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { OxygenEmploymentFields } from './OxygenEmploymentFields';
import type { OxygenFields } from './oxygen-form-utils';

function Form({ initial }: { initial: OxygenFields }) {
  const [fields, setFields] = useState(initial);
  return (
    <OxygenEmploymentFields
      fields={fields}
      onChange={(patch) => setFields((previous) => ({ ...previous, ...patch }))}
    />
  );
}
it('collapses after selecting payday and lets the customer edit without losing values', () => {
  render(
    <Form
      initial={{
        employment_status: 'EMPLOYED',
        name_of_employer: 'Test company',
        salary_amount: '200000',
      }}
    />
  );
  fireEvent.press(screen.getByRole('combobox', { name: 'When are you paid?' }));
  fireEvent.press(screen.getByRole('radio', { name: '29th of every month' }));
  expect(screen.queryByLabelText('Monthly income (₦)')).toBeNull();
  expect(screen.getByText('Paid on the 29th of every month')).toBeTruthy();
  fireEvent.press(
    screen.getByRole('button', { name: 'Edit employment details' })
  );
  expect(screen.getByLabelText('Monthly income (₦)').props.value).toBe(
    '200,000'
  );
  expect(screen.getByLabelText('Employer').props.value).toBe('Test company');
});
it('keeps missing income visible after payday selection', () => {
  render(<Form initial={{ employment_status: 'EMPLOYED' }} />);
  fireEvent.press(screen.getByRole('combobox', { name: 'When are you paid?' }));
  fireEvent.press(screen.getByRole('radio', { name: '1st of every month' }));
  expect(screen.getByLabelText('Monthly income (₦)')).toBeTruthy();
  expect(
    screen.queryByRole('button', { name: 'Edit employment details' })
  ).toBeNull();
});
it('shows fields with errors even when restored employment details are complete', () => {
  render(
    <OxygenEmploymentFields
      fields={{
        employment_status: 'EMPLOYED',
        salary_amount: '200000',
        salary_date: '29',
      }}
      errors={{ salary_amount: 'Check income' }}
      onChange={jest.fn()}
    />
  );
  expect(screen.getByLabelText('Monthly income (₦)')).toBeTruthy();
  expect(screen.getByText('Check income')).toBeTruthy();
});
