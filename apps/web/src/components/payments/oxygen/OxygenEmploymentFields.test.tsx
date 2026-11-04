import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { OxygenEmploymentFields } from './OxygenEmploymentFields';

it('formats income with commas while preserving the raw amount for submission', () => {
  render(
    <form aria-label="Income">
      <OxygenEmploymentFields defaults={{ salary_amount: '500000.50' }} />
    </form>
  );
  const input = screen.getByLabelText('Monthly income (₦)');
  expect(input).toHaveValue('500,000.50');
  fireEvent.change(input, { target: { value: '1000000000' } });
  expect(input).toHaveValue('1,000,000,000');
  expect(
    new FormData(
      screen.getByRole('form', { name: 'Income' }) as HTMLFormElement
    ).get('salary_amount')
  ).toBe('1000000000');
  fireEvent.change(input, { target: { value: '1,234.56' } });
  expect(input).toHaveValue('1,234.56');
  expect(input).toBeValid();
  fireEvent.change(input, { target: { value: '1,234.567' } });
  expect(input).toHaveValue('1,234.56');
  expect(
    new FormData(
      screen.getByRole('form', { name: 'Income' }) as HTMLFormElement
    ).get('salary_amount')
  ).toBe('1234.56');
});
it('offers clear monthly paydays while submitting numeric days', () => {
  render(
    <form aria-label="Income">
      <OxygenEmploymentFields defaults={{ salary_date: '21' }} />
    </form>
  );
  const day = screen.getByLabelText('When are you paid?');
  expect(day).toHaveValue('21');
  for (const name of [
    '1st of every month',
    '2nd of every month',
    '3rd of every month',
    '11th of every month',
    '12th of every month',
    '13th of every month',
    '31st of every month',
  ])
    expect(screen.getByRole('option', { name })).toBeInTheDocument();
  fireEvent.change(day, { target: { value: '31' } });
  expect(
    new FormData(
      screen.getByRole('form', { name: 'Income' }) as HTMLFormElement
    ).get('salary_date')
  ).toBe('31');
  expect(day).toHaveClass('appearance-none', 'pr-10');
});
